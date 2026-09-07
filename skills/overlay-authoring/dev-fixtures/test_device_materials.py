import copy
import importlib.util
import json
from pathlib import Path
import struct
import sys
sys.dont_write_bytecode = True
import unittest

spec = importlib.util.spec_from_file_location('device_materials', Path(__file__).parents[1] / 'scripts/device_materials.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DeviceMaterialsTest(unittest.TestCase):
    def setUp(self):
        self.gltf = {'asset': {'version': '2.0'}, 'materials': [
            {'name': 'screen', 'emissiveFactor': [1, 1, 1], 'emissiveTexture': {'index': 0},
             'pbrMetallicRoughness': {'baseColorFactor': [0, 0, 0, 1]}},
            {'name': 'key', 'pbrMetallicRoughness': {'baseColorFactor': [.03, .03, .04, 1]},
             'extensions': {'KHR_materials_clearcoat': {'clearcoatFactor': .12, 'clearcoatTexture': {'index': 1}}}}
        ], 'meshes': [
            {'name': 'display', 'primitives': [{'material': 0, 'attributes': {'POSITION': 0}}]},
            {'name': 'keyboard', 'primitives': [{'material': 1, 'attributes': {'POSITION': 1}}]},
            {'name': 'usb', 'primitives': [{'material': 1, 'attributes': {'POSITION': 2}}]}
        ], 'animations': [{'name': 'motion'}]}
        self.profiles = [
            {'material': 'screen', 'values': {'metallic': 0, 'roughness': .9, 'specular': .05}},
            {'material': 'key', 'meshes': ['keyboard'], 'name': 'keyboard-matte', 'values': {'roughness': .9, 'specular': .02, 'clearcoat': 0}}
        ]

    def test_selected_mesh_gets_its_own_material_and_usb_and_emission_survive(self):
        before = copy.deepcopy(self.gltf)
        result, records = module.apply_profiles(self.gltf, self.profiles)
        self.assertEqual(self.gltf, before)
        self.assertEqual(result['materials'][1], before['materials'][1])
        self.assertEqual(result['meshes'][2], before['meshes'][2])
        self.assertEqual(result['meshes'][1]['primitives'][0]['material'], 2)
        self.assertEqual(result['materials'][0]['emissiveTexture'], {'index': 0})
        self.assertEqual(result['materials'][0]['emissiveFactor'], [1, 1, 1])
        self.assertEqual(result['materials'][2]['extensions']['KHR_materials_clearcoat']['clearcoatTexture'], {'index': 1})
        self.assertEqual(records[1]['meshes'], ['keyboard'])
        self.assertIn('KHR_materials_specular', result['extensionsUsed'])

    def test_binary_geometry_animation_and_images_are_unchanged_and_output_is_deterministic(self):
        j = json.dumps(self.gltf).encode(); j += b' ' * (-len(j) % 4)
        binary = b'preserve mesh image animation!!! ' * 4
        raw = struct.pack('<III', 0x46546C67, 2, 28 + len(j) + len(binary)) + struct.pack('<II', len(j), module.JSON_CHUNK) + j + struct.pack('<II', len(binary), 0x004E4942) + binary
        out, report = module.prepare_glb(raw, self.profiles)
        result, chunks = module.read_glb(out)
        self.assertEqual(chunks[1][1], binary)
        self.assertEqual(result['animations'], self.gltf['animations'])
        self.assertTrue(report['binary_chunks_unchanged'])
        self.assertEqual(module.prepare_glb(raw, self.profiles)[0], out)

    def test_invalid_profiles_fail_without_mutating_the_input(self):
        before = copy.deepcopy(self.gltf)
        for profile in [
            {'material': 'missing', 'values': {'roughness': .5}},
            {'material': 'key', 'meshes': ['missing'], 'name': 'new', 'values': {'roughness': .5}},
            {'material': 'key', 'meshes': ['keyboard'], 'name': 'screen', 'values': {'roughness': .5}},
            {'material': 'key', 'values': {'brightness': .5}},
            *[{'material': 'key', 'values': {'roughness': value}} for value in [-1, 2, True, float('nan'), float('inf')]],
        ]:
            with self.subTest(profile=profile), self.assertRaises(ValueError):
                module.apply_profiles(self.gltf, [self.profiles[0], profile])
        self.assertEqual(self.gltf, before)

    def test_ambiguous_names_are_rejected(self):
        self.gltf['materials'].append(copy.deepcopy(self.gltf['materials'][0]))
        with self.assertRaises(ValueError): module.apply_profiles(self.gltf, self.profiles)

    def test_truncated_glb_is_rejected(self):
        with self.assertRaises(ValueError): module.read_glb(b'glTF')

if __name__ == '__main__': unittest.main()
