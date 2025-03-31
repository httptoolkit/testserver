export const clearArray = (array: Array<unknown> | undefined) => {
    if (!array) return;
    array.length = 0;
}

export const serializeJson = (json: any) =>
    JSON.stringify(json, null, 2) + '\n';