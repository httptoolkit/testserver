export const serializeJson = (json: any) =>
    JSON.stringify(json, null, 2) + '\n';