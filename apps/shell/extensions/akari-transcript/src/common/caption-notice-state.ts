/** Keep the newest text and show each consecutive notice only once. */
export function nextCaptionNotices(last: string | undefined, notices: readonly string[]): {
    show: string[]; last: string | undefined;
} {
    const show: string[] = [];
    for (const notice of notices) {
        if (notice !== last) show.push(notice);
        last = notice;
    }
    return { show, last };
}
