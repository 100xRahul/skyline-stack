// Tiny procedural sound engine. No audio assets ship with the game — every
// blip is synthesized with the Web Audio API so the bundle stays asset-free and
// there are no licensing questions. A mute toggle persists the player's choice
// (a UI preference only — game progress lives server-side in Redis).

type Tone = {
  freq: number;
  // Optional pitch to glide toward over the note's life.
  toFreq?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
};

const MUTE_STORAGE_KEY = 'skyline:muted';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  // Must be called from within a user gesture (e.g. the START click) so the
  // browser allows audio playback.
  resume() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      // Preference is best-effort; ignore storage failures.
    }
    return this.muted;
  }

  private play(tone: Tone, when = 0) {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = tone.type ?? 'triangle';
    osc.frequency.setValueAtTime(tone.freq, t0);
    if (tone.toFreq) {
      osc.frequency.exponentialRampToValueAtTime(tone.toFreq, t0 + tone.duration);
    }
    const peak = tone.gain ?? 0.18;
    gainNode.gain.setValueAtTime(0.0001, t0);
    gainNode.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.duration);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + tone.duration + 0.02);
  }

  // A clean drop. Pitch rises slightly with the player's combo so consecutive
  // good drops feel like they're climbing.
  drop(combo = 0) {
    const base = 220 + Math.min(combo, 12) * 18;
    this.play({ freq: base, toFreq: base * 1.5, duration: 0.12, gain: 0.16 });
  }

  // A bright two-note chime for a perfect placement.
  perfect(combo = 0) {
    const base = 520 + Math.min(combo, 12) * 22;
    this.play({ freq: base, duration: 0.1, type: 'sine', gain: 0.16 });
    this.play(
      { freq: base * 1.5, duration: 0.16, type: 'sine', gain: 0.14 },
      0.08
    );
  }

  // A descending thud for a miss.
  miss() {
    this.play({ freq: 200, toFreq: 70, duration: 0.4, type: 'sawtooth', gain: 0.2 });
  }

  // A distant, quiet echo of the perfect chime — another builder in the post
  // just landed a flawless run. Low gain so it reads as ambience, not an alert.
  neighborPerfect() {
    this.play({ freq: 660, duration: 0.09, type: 'sine', gain: 0.05 });
    this.play({ freq: 990, duration: 0.14, type: 'sine', gain: 0.04 }, 0.07);
  }

  // A celebratory arpeggio when the community hits its daily goal.
  goal() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) =>
      this.play({ freq: f, duration: 0.22, type: 'sine', gain: 0.16 }, i * 0.11)
    );
  }
}

export const audio = new AudioEngine();
