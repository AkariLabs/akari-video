import { t } from '@akari-video/i18n';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { runEditLint, type EditLintGateResult } from '@akari-video/edit-store/lib/write-gate';
import { lintFindingKey } from '../common/lint-blame-scope';

interface Snapshot { edit: string | null; captions: string | null }
interface PendingBaseline {
    snapshot: Promise<Snapshot | undefined>;
    writtenFiles: Set<string>;
    generation: number;
}
interface BlameResult {
    writtenFiles: string[];
    existingFindingKeys?: string[];
    findingKeys?: string[];
}

export class DeferredLintBaseline {
    private readonly pending = new Map<string, PendingBaseline>();
    private readonly completed = new Map<string, { snapshot: Snapshot; findings: EditLintGateResult['findings'] }>();

    constructor(private readonly lint: typeof runEditLint = runEditLint,
        private readonly readText: (path: string) => Promise<string> = path => fs.readFile(path, 'utf8')) {}

    private async readSnapshot(projectDir: string): Promise<Snapshot> {
        const read = async (name: string): Promise<string | null> => {
            try { return await this.readText(join(projectDir, name)); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
                throw error;
            }
        };
        const [edit, captions] = await Promise.all([read('edit.json'), read('captions.json')]);
        return { edit, captions };
    }

    async begin(projectDir: string, writtenFiles: readonly string[]): Promise<void> {
        const key = resolve(projectDir);
        let baseline = this.pending.get(key);
        if (!baseline) {
            baseline = {
                snapshot: this.readSnapshot(key).catch(error => {
                    console.warn(t('annotations.deferredLintBaseline.ui.couldNotReadPreSaveComparisonFileError'), error);
                    return undefined;
                }),
                writtenFiles: new Set(),
                generation: 0
            };
            this.pending.set(key, baseline);
        }
        writtenFiles.forEach(name => baseline!.writtenFiles.add(name));
        baseline.generation++;
        await baseline.snapshot;
    }

    writtenFiles(projectDir: string): string[] {
        return [...(this.pending.get(resolve(projectDir))?.writtenFiles ?? [])];
    }

    async finish(projectDir: string, result: EditLintGateResult): Promise<BlameResult | undefined> {
        const key = resolve(projectDir);
        const baseline = this.pending.get(key);
        if (!baseline) return { writtenFiles: [] };
        const generation = baseline.generation;
        const writtenFiles = [...baseline.writtenFiles];
        let blame: BlameResult = { writtenFiles };
        let after: Snapshot | undefined;
        try {
            after = await this.readSnapshot(key);
            const ownErrors = result.findings.filter(finding => finding.severity === 'error'
                && writtenFiles.includes(finding.path?.split('#', 1)[0] ?? ''));
            if (!result.pass && ownErrors.length > 0 && baseline.generation === generation) {
                const before = await baseline.snapshot;
                if (before) {
                    const cached = this.completed.get(key);
                    const previous = cached?.snapshot.edit === before.edit
                        && cached.snapshot.captions === before.captions
                        ? cached.findings : (await this.lint(key,
                            { 'edit.json': before.edit, 'captions.json': before.captions }, false)).findings;
                    if (previous.some(finding => finding.check === 'edit-lint.execution')) {
                        throw new Error(t('annotations.deferredLintBaseline.ui.preSaveValidationNotAvailableError'));
                    }
                    blame = {
                        writtenFiles,
                        existingFindingKeys: previous.filter(finding => finding.severity === 'error')
                            .map(finding => lintFindingKey(finding, before.captions ?? undefined)),
                        findingKeys: result.findings.map(finding => lintFindingKey(finding, after!.captions ?? undefined))
                    };
                }
            }
        } catch (error) {
            console.warn(t('annotations.deferredLintBaseline.ui.couldNotCompareFindingsBeforeSavingError'), error);
        }
        if (this.pending.get(key) !== baseline || baseline.generation !== generation) return undefined;
        if (after) this.completed.set(key, { snapshot: after, findings: result.findings });
        this.pending.delete(key);
        return blame;
    }
}
