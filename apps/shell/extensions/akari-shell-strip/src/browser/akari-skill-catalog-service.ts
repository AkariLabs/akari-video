import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { SkillEntry, parseFrontmatter } from '../common/skill-catalog';

@injectable()
export class AkariSkillCatalogService {
    @inject(FileService) protected readonly files!: FileService;

    async loadSkills(rootUri: URI | undefined): Promise<SkillEntry[]> {
        if (!rootUri) return [];
        let directories;
        try {
            const stat = await this.files.resolve(rootUri.resolve('.claude/skills'));
            directories = (stat.children ?? []).filter(child => child.isDirectory);
        } catch { return []; }
        const parsed: SkillEntry[] = [];
        for (const directory of directories) {
            try {
                const content = await this.files.readFile(directory.resource.resolve('SKILL.md'));
                const entry = parseFrontmatter(content.value.toString());
                if (entry) parsed.push(entry);
            } catch { /* 読めない項目は飛ばす。 */ }
        }
        return parsed.sort((left, right) => left.name.localeCompare(right.name));
    }
}
