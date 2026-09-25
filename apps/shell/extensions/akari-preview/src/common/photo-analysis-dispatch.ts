export interface PhotoAnalysisEventDetail {
    editUri?: string;
    id?: string;
    kind?: 'horizon' | 'saliency';
    accept: () => void;
    resolve: (result: unknown) => void;
}

/** A listener accepts synchronously; its analysis result may arrive later. */
export function dispatchPhotoAnalysis(
    request: Pick<PhotoAnalysisEventDetail, 'editUri' | 'id' | 'kind'>,
    dispatch: (detail: PhotoAnalysisEventDetail) => void,
    schedule: (callback: () => void, delay: number) => void
): Promise<unknown> {
    return new Promise(resolve => {
        let accepted = false;
        let settled = false;
        const reply = (result: unknown): void => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        dispatch({ ...request, accept: () => { accepted = true; }, resolve: reply });
        if (!accepted) reply({ available: false });
        else if (!settled) schedule(() => reply({ available: false }), 30_000);
    });
}
