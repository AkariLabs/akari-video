import { OnboardingState, TranscriptSegment } from './model';

export const AKARI_ONBOARDING_SERVICE_PATH = '/services/akari-surfaces-onboarding-v1';
export const AkariOnboardingService = Symbol('AkariOnboardingService');

export interface SampleInformation {
    sourcePath: string;
    segments: TranscriptSegment[];
}

export interface AkariOnboardingService {
    heroDataUrl(): Promise<string>;
    load(): Promise<OnboardingState | undefined>;
    save(state: OnboardingState): Promise<void>;
    markSeen(): Promise<void>;
    returnToHome(): Promise<void>;
    prepare(): Promise<{ projectUri: string; sample: SampleInformation }>;
    importSample(projectUri: string, sourcePath: string): Promise<string>;
    writeExample(projectUri: string, sourcePath: string, segments: TranscriptSegment[], count: number, title: boolean): Promise<void>;
    lintExample(projectUri: string): Promise<number>;
    hasExport(projectUri: string): Promise<boolean>;
}
