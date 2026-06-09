export type AnnouncementVoiceGender = "female" | "male";
export type AnnouncementPitchLabel = "low" | "normal" | "high";

const FEMALE_VOICE_HINTS = ["female", "woman", "zira", "jenny", "aria", "susan", "samantha", "victoria", "karen"];
const MALE_VOICE_HINTS = ["male", "man", "david", "mark", "guy", "george", "alex", "daniel"];

export function getAnnouncementVoiceId(voice: SpeechSynthesisVoice) {
  return voice.voiceURI || `${voice.name}|${voice.lang}`;
}

export function getEnglishUsVoices(voices: SpeechSynthesisVoice[]) {
  return voices.filter((voice) => {
    const lang = voice.lang.toLowerCase();
    return lang === "en-us" || lang.startsWith("en-us");
  });
}

export function inferAnnouncementVoiceGender(name: string): AnnouncementVoiceGender {
  const normalized = name.toLowerCase();
  if (MALE_VOICE_HINTS.some((hint) => normalized.includes(hint))) return "male";
  return "female";
}

export function getAnnouncementVoiceLabel(voiceName: string, voiceGender: AnnouncementVoiceGender) {
  const genderLabel = voiceGender === "male" ? "Male" : "Female";
  return voiceName ? `${voiceName} (${genderLabel})` : "No voice selected";
}

export function resolveAnnouncementVoice(
  voices: SpeechSynthesisVoice[],
  selectedVoiceId?: string | null,
  selectedVoiceName?: string | null,
  strict = false,
) {
  const englishVoices = getEnglishUsVoices(voices);
  if (selectedVoiceId) {
    const byId = englishVoices.find((voice) => getAnnouncementVoiceId(voice) === selectedVoiceId);
    if (byId) return byId;
    if (strict) return null;
  }
  if (selectedVoiceName) {
    const byName = englishVoices.find((voice) => voice.name === selectedVoiceName);
    if (byName) return byName;
    const fuzzyByName = englishVoices.find((voice) => voice.name.toLowerCase().includes(selectedVoiceName.toLowerCase()));
    if (fuzzyByName) return fuzzyByName;
    if (strict) return null;
  }

  if (strict) return null;

  const femaleVoices = englishVoices.filter((voice) => inferAnnouncementVoiceGender(voice.name) === "female");
  const preferredZira = femaleVoices.find((voice) => voice.name.toLowerCase().includes("zira"));
  if (preferredZira) return preferredZira;
  if (femaleVoices.length > 0) return femaleVoices[0];

  return englishVoices[0] ?? null;
}

export function getPitchLabel(value: number): AnnouncementPitchLabel {
  if (value <= 0.85) return "low";
  if (value >= 1.15) return "high";
  return "normal";
}

export function getPitchValue(label: AnnouncementPitchLabel) {
  if (label === "low") return 0.8;
  if (label === "high") return 1.2;
  return 1;
}

export function getReadableQueueNumber(queueNumber: string) {
  return queueNumber
    .replace(/-/g, " ")
    .split("")
    .map((character) => {
      if (character === "0") return "zero";
      if (/[A-Za-z]/.test(character)) return character.toUpperCase();
      return character;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getQueueAnnouncementText(item: { queueNumber: string; studentName?: string | null; counterName?: string | null }) {
  const studentName = item.studentName?.trim();
  const readableQueueNumber = getReadableQueueNumber(item.queueNumber);
  const counterTarget = item.counterName?.trim() || "your assigned counter";

  return [
    `Queue Number ${readableQueueNumber}.`,
    studentName || "",
    `Please proceed to ${counterTarget}.`,
  ].filter(Boolean).join(" ");
}

