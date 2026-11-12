// Scan-reading (OCR) providers. Like the web-search backends they are saved as
// an owner's own key in user_api_keys / org_api_keys, but they are not AI
// models: they never reach the model catalog or the chat's model picker.
export const OCR_PROVIDERS = ["landingai"] as const;

export type OcrProvider = (typeof OCR_PROVIDERS)[number];

export const isOcrProvider = (value: string): value is OcrProvider =>
    (OCR_PROVIDERS as readonly string[]).includes(value);
