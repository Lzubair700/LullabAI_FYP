import { useEffect, useRef, useState } from 'react';

type TextToSpeechControlsProps = {
  text: string | undefined;
};

const ARCANA_ENDPOINT = 'https://users.rime.ai/v1/rime-tts';
const DEFAULT_SPEAKER = 'sirius';

// Common Rime Arcana voices
const ARCANA_VOICES = [
  { value: 'sirius', label: 'Sirius' },
  { value: 'luna', label: 'Luna' },
  { value: 'orion', label: 'Orion' },
  { value: 'celeste', label: 'Celeste' },
  // { value: 'athena', label: 'Athena' }, // Commonly unavailable on free tier
  // { value: 'hera', label: 'Hera' },
  // { value: 'zeus', label: 'Zeus' },
  // { value: 'apollo', label: 'Apollo' },
];

export default function TextToSpeechControls({
  text,
}: TextToSpeechControlsProps) {
  const [speaker, setSpeaker] = useState(DEFAULT_SPEAKER);
  // Hardcoded "Child-Friendly" settings
  // speedAlpha: > 1.0 is SLOWER. < 1.0 is FASTER.
  // We want slightly slower for clear storytelling.
  const speed = 1.1;
  // Temperature: Lower value (e.g. 0.7) is more stable/clear. High values (>1.0) cause distortion.
  const temperature = 0.7;

  const [status, setStatus] = useState<'idle' | 'requesting' | 'playing'>(
    'idle'
  );
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const apiKey = import.meta.env.VITE_RIME_API_KEY?.trim();

  useEffect(() => {
    return () => {
      stopCurrentAudio();
      revokeAudioUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopCurrentAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  };

  const revokeAudioUrl = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  };

  const playStory = async () => {
    if (!text?.trim()) {
      setError('Generate a story first to enable narration.');
      return;
    }

    if (!apiKey) {
      setError('Add VITE_RIME_API_KEY to your .env file to enable TTS.');
      return;
    }

    setStatus('requesting');
    setError(null);
    stopCurrentAudio();
    revokeAudioUrl();

    try {
      const response = await fetch(ARCANA_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'audio/mp3',
        },
        body: JSON.stringify({
          text,
          speaker,
          modelId: 'arcana',
          speedAlpha: speed,
          temperature: temperature,
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(
          message || `Arcana TTS failed with status ${response.status}`
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      const audio = new Audio(url);
      audioRef.current = audio;
      setStatus('playing');

      audio.onended = () => setStatus('idle');
      audio.onerror = () => {
        setError('Playback failed. Try again.');
        setStatus('idle');
      };

      await audio.play();
    } catch (err) {
      setStatus('idle');
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Something went wrong while generating audio.');
      }
    }
  };

  const stopPlayback = () => {
    stopCurrentAudio();
    setStatus('idle');
  };

  const downloadAudio = () => {
    if (!audioUrl) return;
    const anchor = document.createElement('a');
    anchor.href = audioUrl;
    anchor.download = 'lullabai-story.mp3';
    anchor.click();
  };

  const isRequesting = status === 'requesting';
  const isPlaying = status === 'playing';

  return (
    <div className="tts-controls">
      <div className="tts-settings-row">
        <div className="tts-field">
          <label htmlFor="tts-speaker">Voice</label>
          <select
            id="tts-speaker"
            value={speaker}
            onChange={(event) => setSpeaker(event.target.value)}
            disabled={isRequesting}
          >
            {ARCANA_VOICES.map((voice) => (
              <option key={voice.value} value={voice.value}>
                {voice.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tts-actions">
        <button className="tts-btn primary" onClick={playStory} disabled={isRequesting}>
          {isRequesting ? 'Generating...' : 'Play Story Audio'}
        </button>

        <button
          className="tts-btn secondary"
          onClick={isPlaying ? stopPlayback : downloadAudio}
          disabled={!audioUrl && !isPlaying}
        >
          {isPlaying ? 'Stop' : 'Download MP3'}
        </button>
      </div>

      {error && <p className="tts-error">{error}</p>}
    </div>
  );
}

