import {
  ActivityHandling,
  EndSensitivity,
  StartSensitivity,
} from "@google/genai";
import { getVoiceModel, type VoiceModelId, type VoiceProvider } from "./voiceModels";

export type NoiseCancellationMode = "off" | "near_field" | "far_field";
export type InterruptSensitivity = "low" | "medium" | "high";
export type OpenAIVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "cedar"
  | "coral"
  | "echo"
  | "marin"
  | "sage"
  | "shimmer"
  | "verse";
export type GeminiVoice =
  | "Zephyr"
  | "Puck"
  | "Charon"
  | "Kore"
  | "Fenrir"
  | "Leda"
  | "Orus"
  | "Aoede"
  | "Callirrhoe"
  | "Autonoe"
  | "Enceladus"
  | "Iapetus"
  | "Umbriel"
  | "Algieba"
  | "Despina"
  | "Erinome"
  | "Algenib"
  | "Rasalgethi"
  | "Laomedeia"
  | "Achernar"
  | "Alnilam"
  | "Schedar"
  | "Gacrux"
  | "Pulcherrima"
  | "Achird"
  | "Zubenelgenubi"
  | "Vindemiatrix"
  | "Sadachbia"
  | "Sadaltager"
  | "Sulafat";

export type VoiceSettings = {
  speechSpeed: number;
  noiseCancellation: NoiseCancellationMode;
  interruptSensitivity: InterruptSensitivity;
  openAIVoice: OpenAIVoice;
  geminiVoice: GeminiVoice;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  speechSpeed: 1,
  noiseCancellation: "far_field",
  interruptSensitivity: "medium",
  openAIVoice: "ash",
  geminiVoice: "Puck",
};

export type VoiceOption = {
  value: string;
  label: string;
  description: string;
};

export const OPENAI_VOICE_OPTIONS: Array<VoiceOption & { value: OpenAIVoice }> = [
  { value: "ash", label: "Ash", description: "Warm and even" },
  { value: "alloy", label: "Alloy", description: "Neutral and balanced" },
  { value: "ballad", label: "Ballad", description: "Calm and expressive" },
  { value: "cedar", label: "Cedar", description: "Natural and clear" },
  { value: "coral", label: "Coral", description: "Bright and clear" },
  { value: "echo", label: "Echo", description: "Crisp and direct" },
  { value: "marin", label: "Marin", description: "Natural and expressive" },
  { value: "sage", label: "Sage", description: "Measured and conversational" },
  { value: "shimmer", label: "Shimmer", description: "Light and upbeat" },
  { value: "verse", label: "Verse", description: "Natural and expressive" },
];

export const GEMINI_VOICE_OPTIONS: Array<VoiceOption & { value: GeminiVoice }> = [
  { value: "Puck", label: "Puck", description: "Upbeat" },
  { value: "Zephyr", label: "Zephyr", description: "Bright" },
  { value: "Charon", label: "Charon", description: "Informative" },
  { value: "Kore", label: "Kore", description: "Firm" },
  { value: "Fenrir", label: "Fenrir", description: "Excitable" },
  { value: "Leda", label: "Leda", description: "Youthful" },
  { value: "Orus", label: "Orus", description: "Firm" },
  { value: "Aoede", label: "Aoede", description: "Breezy" },
  { value: "Callirrhoe", label: "Callirrhoe", description: "Easygoing" },
  { value: "Autonoe", label: "Autonoe", description: "Bright" },
  { value: "Enceladus", label: "Enceladus", description: "Breathy" },
  { value: "Iapetus", label: "Iapetus", description: "Clear" },
  { value: "Umbriel", label: "Umbriel", description: "Easygoing" },
  { value: "Algieba", label: "Algieba", description: "Smooth" },
  { value: "Despina", label: "Despina", description: "Smooth" },
  { value: "Erinome", label: "Erinome", description: "Clear" },
  { value: "Algenib", label: "Algenib", description: "Gravelly" },
  { value: "Rasalgethi", label: "Rasalgethi", description: "Informative" },
  { value: "Laomedeia", label: "Laomedeia", description: "Upbeat" },
  { value: "Achernar", label: "Achernar", description: "Soft" },
  { value: "Alnilam", label: "Alnilam", description: "Firm" },
  { value: "Schedar", label: "Schedar", description: "Even" },
  { value: "Gacrux", label: "Gacrux", description: "Mature" },
  { value: "Pulcherrima", label: "Pulcherrima", description: "Forward" },
  { value: "Achird", label: "Achird", description: "Friendly" },
  { value: "Zubenelgenubi", label: "Zubenelgenubi", description: "Casual" },
  { value: "Vindemiatrix", label: "Vindemiatrix", description: "Gentle" },
  { value: "Sadachbia", label: "Sadachbia", description: "Lively" },
  { value: "Sadaltager", label: "Sadaltager", description: "Knowledgeable" },
  { value: "Sulafat", label: "Sulafat", description: "Warm" },
];

export const SPEECH_SPEED_OPTIONS = [
  { value: 0.9, label: "Slower" },
  { value: 1, label: "Normal" },
  { value: 1.15, label: "Fast" },
  { value: 1.3, label: "Very fast" },
] as const;

export const NOISE_CANCELLATION_OPTIONS: Array<{
  value: NoiseCancellationMode;
  label: string;
  description: string;
}> = [
  {
    value: "far_field",
    label: "Laptop or room",
    description: "Best for built-in microphones and speakerphone use",
  },
  {
    value: "near_field",
    label: "Headset",
    description: "Best for close microphones and earbuds",
  },
  {
    value: "off",
    label: "Off",
    description: "No input noise filtering",
  },
];

export const INTERRUPT_SENSITIVITY_OPTIONS: Array<{
  value: InterruptSensitivity;
  label: string;
  description: string;
}> = [
  {
    value: "low",
    label: "Low",
    description: "You need to speak more clearly to interrupt the assistant",
  },
  {
    value: "medium",
    label: "Balanced",
    description: "A normal balance between accidental and quick interrupts",
  },
  {
    value: "high",
    label: "High",
    description: "Your voice cuts in more easily while the assistant is talking",
  },
];

export function getVoiceSettings(value: unknown): VoiceSettings {
  if (!value || typeof value !== "object") return DEFAULT_VOICE_SETTINGS;
  const raw = value as Partial<VoiceSettings>;

  const speechSpeed = SPEECH_SPEED_OPTIONS.some(
    (option) => option.value === raw.speechSpeed,
  )
    ? raw.speechSpeed
    : DEFAULT_VOICE_SETTINGS.speechSpeed;

  const noiseCancellation = NOISE_CANCELLATION_OPTIONS.some(
    (option) => option.value === raw.noiseCancellation,
  )
    ? raw.noiseCancellation
    : DEFAULT_VOICE_SETTINGS.noiseCancellation;

  const interruptSensitivity = INTERRUPT_SENSITIVITY_OPTIONS.some(
    (option) => option.value === raw.interruptSensitivity,
  )
    ? raw.interruptSensitivity
    : DEFAULT_VOICE_SETTINGS.interruptSensitivity;
  const openAIVoice =
    typeof raw.openAIVoice === "string"
      ? (raw.openAIVoice as OpenAIVoice)
      : DEFAULT_VOICE_SETTINGS.openAIVoice;
  const geminiVoice =
    typeof raw.geminiVoice === "string"
      ? (raw.geminiVoice as GeminiVoice)
      : DEFAULT_VOICE_SETTINGS.geminiVoice;

  return {
    speechSpeed: speechSpeed ?? DEFAULT_VOICE_SETTINGS.speechSpeed,
    noiseCancellation:
      noiseCancellation ?? DEFAULT_VOICE_SETTINGS.noiseCancellation,
    interruptSensitivity:
      interruptSensitivity ?? DEFAULT_VOICE_SETTINGS.interruptSensitivity,
    openAIVoice: openAIVoice ?? DEFAULT_VOICE_SETTINGS.openAIVoice,
    geminiVoice: geminiVoice ?? DEFAULT_VOICE_SETTINGS.geminiVoice,
  };
}

export function parseStoredVoiceSettings(stored: string | null): VoiceSettings {
  if (!stored) return DEFAULT_VOICE_SETTINGS;
  try {
    return getVoiceSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

export function getOpenAIRealtimeSettings(settings: VoiceSettings) {
  const thresholds = {
    low: { threshold: 0.78, silenceDurationMs: 700 },
    medium: { threshold: 0.65, silenceDurationMs: 500 },
    high: { threshold: 0.5, silenceDurationMs: 350 },
  } satisfies Record<
    InterruptSensitivity,
    { threshold: number; silenceDurationMs: number }
  >;
  const selected = thresholds[settings.interruptSensitivity];

  const turnDetection = {
    type: "server_vad",
    threshold: selected.threshold,
    prefix_padding_ms: 200,
    silence_duration_ms: selected.silenceDurationMs,
    create_response: true,
    interrupt_response: true,
  };
  const inputAudioNoiseReduction =
    settings.noiseCancellation === "off"
      ? null
      : { type: settings.noiseCancellation };

  return {
    speed: settings.speechSpeed,
    inputAudioNoiseReduction,
    turnDetection,
  };
}

export function getGeminiRealtimeSettings(settings: VoiceSettings) {
  const activityDetection = {
    low: {
      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
      prefixPaddingMs: 200,
      silenceDurationMs: 700,
    },
    medium: {
      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
      prefixPaddingMs: 160,
      silenceDurationMs: 500,
    },
    high: {
      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
      prefixPaddingMs: 120,
      silenceDurationMs: 350,
    },
  } satisfies Record<InterruptSensitivity, Record<string, unknown>>;

  const playbackRates: Record<number, number> = {
    0.9: 0.9,
    1: 1,
    1.15: 1.08,
    1.3: 1.15,
  };

  return {
    voice: settings.geminiVoice,
    speechSpeed: playbackRates[settings.speechSpeed] ?? settings.speechSpeed,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: settings.geminiVoice,
        },
      },
    },
    mediaTrackConstraints: {
      channelCount: 1,
      echoCancellation: settings.noiseCancellation !== "off",
      noiseSuppression: settings.noiseCancellation !== "off",
      autoGainControl: settings.noiseCancellation !== "off",
    },
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        ...activityDetection[settings.interruptSensitivity],
      },
      activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
    },
  };
}

export function getVoiceOptionsForModel(voiceModel: VoiceModelId): VoiceOption[] {
  const provider = getVoiceModel(voiceModel).provider;
  return provider === "gemini" ? GEMINI_VOICE_OPTIONS : OPENAI_VOICE_OPTIONS;
}

export function getSelectedVoiceForModel(
  voiceModel: VoiceModelId,
  settings: VoiceSettings,
): string {
  const provider = getVoiceModel(voiceModel).provider;
  return provider === "gemini" ? settings.geminiVoice : settings.openAIVoice;
}

export function getVoiceSettingPatch(
  provider: VoiceProvider,
  value: string,
): Partial<VoiceSettings> {
  if (provider === "gemini") {
    return {
      geminiVoice: value as GeminiVoice,
    };
  }

  return {
    openAIVoice: value as OpenAIVoice,
  };
}
