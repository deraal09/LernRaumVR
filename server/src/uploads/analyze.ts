export interface VideoInfo {
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
  bitrate?: number;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string };
}

function parseRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [n, d] = rate.split('/').map(Number);
  if (!n || !d) return undefined;
  return Math.round((n / d) * 100) / 100;
}

/** Richtwerte für die PICO G2 4K; in Phase 0 mit echten Testvideos abgleichen (docs/phase0.md). */
const SUPPORTED_CODECS = new Set(['h264', 'hevc']);
const MAX_WIDTH = 3840;
const MAX_HEIGHT = 2160;
const MAX_FPS = 60;

export function analyzeVideo(probe: FfprobeOutput): { info: VideoInfo; warnings: string[] } {
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  const warnings: string[] = [];
  if (!video) {
    return { info: {}, warnings: ['Keine Videospur gefunden.'] };
  }
  const info: VideoInfo = {};
  if (video.codec_name) info.codec = video.codec_name;
  if (video.width) info.width = video.width;
  if (video.height) info.height = video.height;
  const fps = parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate);
  if (fps) info.fps = fps;
  if (probe.format?.duration) info.durationSec = Math.round(Number(probe.format.duration));
  if (probe.format?.bit_rate) info.bitrate = Number(probe.format.bit_rate);

  if (info.codec && !SUPPORTED_CODECS.has(info.codec)) {
    warnings.push(`Codec „${info.codec}“ wird auf der Brille möglicherweise nicht abgespielt (empfohlen: H.264 oder H.265).`);
  }
  if ((info.width ?? 0) > MAX_WIDTH || (info.height ?? 0) > MAX_HEIGHT) {
    warnings.push(`Auflösung ${info.width}×${info.height} liegt über 4K (${MAX_WIDTH}×${MAX_HEIGHT}).`);
  }
  if ((info.fps ?? 0) > MAX_FPS) {
    warnings.push(`Bildrate ${info.fps} fps liegt über ${MAX_FPS} fps.`);
  }
  return { info, warnings };
}
