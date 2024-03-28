export const clearArray = (array: Array<unknown> | undefined) => {
    if (!array) return;
    array.length = 0;
}