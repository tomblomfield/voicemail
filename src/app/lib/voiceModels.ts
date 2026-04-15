export type VoiceProvider = "openai" | "gemini";

export type VoiceModelId =
  | "gpt-realtime-1.5"
  | "gemini-3.1-flash-live-preview";

export type VoiceModelOption = {
  id: VoiceModelId;
  label: string;
  provider: VoiceProvider;
  model: string;
  description: string;
};

export const DEFAULT_VOICE_MODEL: VoiceModelId = "gpt-realtime-1.5";

export const GEMINI_31_FLASH_TTS_MODEL = "gemini-3.1-flash-tts-preview";

export const VOICE_MODELS: VoiceModelOption[] = [
  {
    id: "gpt-realtime-1.5",
    label: "GPT Realtime 1.5",
    provider: "openai",
    model: "gpt-realtime-1.5",
    description: "OpenAI realtime voice",
  },
  {
    id: "gemini-3.1-flash-live-preview",
    label: "Gemini 3.1 Flash TTS",
    provider: "gemini",
    model: "gemini-3.1-flash-live-preview",
    description: "Google Gemini Live voice with tools",
  },
];

export function getVoiceModel(id: string | null | undefined): VoiceModelOption {
  return (
    VOICE_MODELS.find((model) => model.id === id) ??
    VOICE_MODELS.find((model) => model.id === DEFAULT_VOICE_MODEL)!
  );
}
