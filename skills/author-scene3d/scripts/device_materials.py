"""Explicit, reproducible material profiles at the glTF export boundary.

No material is selected by convention. Numeric factors are authored per model and lighting.
Import export_glb from a Blender recipe, or use --input/--output/--profiles for a derivative.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import tempfile

JSON_CHUNK = 0x4E4F534A
FACTORS = {
    'metallic': ('pbrMetallicRoughness', 'metallicFactor'),
    'roughness': ('pbrMetallicRoughness', 'roughnessFactor'),
    'specular': ('KHR_materials_specular', 'specularFactor'),
    'clearcoat': ('KHR_materials_clearcoat', 'clearcoatFactor'),
    'clearcoat_roughness': ('KHR_materials_clearcoat', 'clearcoatRoughnessFactor'),
}


def read_glb(data):
    if len(data) < 20 or struct.unpack_from('<III', data) != (0x46546C67, 2, len(data)):
        raise ValueError('Expected a complete glTF 2.0 GLB')
    chunks = []
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError('Truncated GLB chunk header')
        size, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        if size % 4 or offset + size > len(data):
            raise ValueError('Invalid GLB chunk size')
        chunks.append((kind, data[offset:offset + size]))
        offset += size
    if not chunks or chunks[0][0] != JSON_CHUNK or sum(k == JSON_CHUNK for k, _ in chunks) != 1:
        raise ValueError('Expected exactly one leading JSON chunk')
    return json.loads(chunks[0][1]), chunks


def apply_profiles(gltf, profiles):
    """Return a copy and audit records; preserve all unselected data and texture bindings."""
    if not isinstance(profiles, list) or not profiles:
        raise ValueError('profiles must be a nonempty array of explicit targets')
    result = copy.deepcopy(gltf)
    records = []
    for profile in profiles:
        if not isinstance(profile, dict) or set(profile) - {'material', 'meshes', 'name', 'values'}:
            raise ValueError('A profile accepts material, meshes, name, values only')
        name = profile.get('material')
        matches = [i for i, m in enumerate(result.get('materials', [])) if m.get('name') == name]
        if not isinstance(name, str) or not name or len(matches) != 1:
            raise ValueError(f'Material must match exactly once: {name!r}')
        values = profile.get('values')
        if not isinstance(values, dict) or not values or set(values) - FACTORS.keys():
            raise ValueError(f'Explicit material factors required: {name}')
        for key, value in values.items():
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError(f'{name}.{key} must be finite and between 0 and 1')
        index = matches[0]
        material = result['materials'][index]
        before = copy.deepcopy(material)
        affected = []
        if 'meshes' in profile:
            targets = profile['meshes']
            if not isinstance(targets, list) or not targets or any(not isinstance(t, str) or not t for t in targets) or len(set(targets)) != len(targets):
                raise ValueError('meshes must contain unique explicit mesh names')
            clone_name = profile.get('name')
            if not isinstance(clone_name, str) or not clone_name or any(m.get('name') == clone_name for m in result['materials']):
                raise ValueError('Mesh-scoped profiles require a unique cloned material name')
            material = copy.deepcopy(material)
            material['name'] = clone_name
            replacement = len(result['materials'])
            for target in targets:
                meshes = [m for m in result.get('meshes', []) if m.get('name') == target]
                if len(meshes) != 1:
                    raise ValueError(f'Mesh must match exactly once: {target}')
                primitives = [p for p in meshes[0].get('primitives', []) if p.get('material') == index]
                if not primitives:
                    raise ValueError(f'{target} does not use {name}')
                for primitive in primitives:
                    primitive['material'] = replacement
                affected.append(target)
            result['materials'].append(material)
        elif 'name' in profile:
            raise ValueError('name is only used when cloning for explicit meshes')
        else:
            affected = [m.get('name') for m in result.get('meshes', []) if any(p.get('material') == index for p in m.get('primitives', []))]
        for key, value in values.items():
            section, field = FACTORS[key]
            if section == 'pbrMetallicRoughness':
                material.setdefault(section, {})[field] = value
            else:
                material.setdefault('extensions', {}).setdefault(section, {})[field] = value
                used = result.setdefault('extensionsUsed', [])
                if section not in used:
                    used.append(section)
        records.append({'material': name, 'meshes': affected, 'before': before, 'after': copy.deepcopy(material)})
    return result, records


def prepare_glb(data, profiles):
    gltf, chunks = read_glb(data)
    result, records = apply_profiles(gltf, profiles)
    encoded = json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    encoded += b' ' * (-len(encoded) % 4)
    updated = [(JSON_CHUNK, encoded), *chunks[1:]]
    output = struct.pack('<III', 0x46546C67, 2, 12 + sum(8 + len(b) for _, b in updated))
    output += b''.join(struct.pack('<II', len(b), kind) + b for kind, b in updated)
    return output, {
        'source_sha256': hashlib.sha256(data).hexdigest(),
        'output_sha256': hashlib.sha256(output).hexdigest(),
        'binary_chunks_unchanged': chunks[1:] == read_glb(output)[1][1:],
        'changes': records,
    }


def export_glb(filepath, profiles, **options):
    """Blender recipe entry: export and prepare in one operation, before publishing the GLB."""
    import bpy
    target = Path(filepath)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='akari-material-export-', dir=target.parent) as tmp:
        raw = Path(tmp) / 'scene.glb'
        bpy.ops.export_scene.gltf(filepath=str(raw), export_format='GLB', **options)
        prepared, report = prepare_glb(raw.read_bytes(), profiles)
        ready = Path(tmp) / 'ready.glb'
        ready.write_bytes(prepared)
        ready.replace(target)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--profiles', required=True, type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve() or args.output.exists():
        parser.error('Write a new derivative; input and existing files cannot be overwritten')
    if args.report and (args.report.exists() or args.report.resolve() in {args.input.resolve(), args.output.resolve(), args.profiles.resolve()}):
        parser.error('Report must be a new, separate file')
    output, report = prepare_glb(args.input.read_bytes(), json.loads(args.profiles.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
