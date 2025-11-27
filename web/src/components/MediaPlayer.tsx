import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, PlayCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { getApiUrl } from '../lib/api';

export interface MediaPlayerRef {
  seekTo: (time: number) => void;
  getCurrentTime: () => number;
  play: () => void;
  pause: () => void;
}

interface MediaPlayerProps {
  projectId: number;
  isVideo: boolean;
  hasAudioPath: boolean; // 是否有提取的音频文件
  playerMode: 'audio' | 'video';
  onTimeUpdate?: (currentTime: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  className?: string;
}

export const MediaPlayer = forwardRef<MediaPlayerRef, MediaPlayerProps>(
  ({ projectId, isVideo, hasAudioPath, playerMode, onTimeUpdate, onPlay, onPause, className }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);

    const mediaRef = playerMode === 'video' && isVideo ? videoRef : audioRef;
    const showVideo = playerMode === 'video' && isVideo;

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        if (mediaRef.current) {
          mediaRef.current.currentTime = time;
        }
      },
      getCurrentTime: () => currentTime,
      play: () => {
        mediaRef.current?.play().catch(err => {
          console.error('播放失败:', err);
        });
      },
      pause: () => {
        mediaRef.current?.pause();
      },
    }));

    // 媒体 URL - 根据模式选择原始文件或提取的音频
    // 音频模式：如果有提取的音频文件，使用提取的音频；否则使用原始文件
    // 视频模式：使用原始文件
    const baseMediaUrl = `${getApiUrl()}/projects/${projectId}/media`;
    const mediaUrl = showVideo
      ? baseMediaUrl
      : (hasAudioPath
          ? `${baseMediaUrl}?type=audio`
          : baseMediaUrl); // 如果没有提取的音频，回退到原始文件

    // 处理时间更新
    useEffect(() => {
      const media = mediaRef.current;
      if (!media) return;

      const handleTimeUpdate = () => {
        const time = media.currentTime;
        setCurrentTime(time);
        onTimeUpdate?.(time);
      };

      const handleLoadedMetadata = () => {
        setDuration(media.duration || 0);
      };

      const handlePlay = () => {
        setIsPlaying(true);
        onPlay?.();
      };

      const handlePause = () => {
        setIsPlaying(false);
        onPause?.();
      };

      media.addEventListener('timeupdate', handleTimeUpdate);
      media.addEventListener('loadedmetadata', handleLoadedMetadata);
      media.addEventListener('play', handlePlay);
      media.addEventListener('pause', handlePause);

      return () => {
        media.removeEventListener('timeupdate', handleTimeUpdate);
        media.removeEventListener('loadedmetadata', handleLoadedMetadata);
        media.removeEventListener('play', handlePlay);
        media.removeEventListener('pause', handlePause);
      };
    }, [onTimeUpdate, onPlay, onPause, showVideo]);

    // 同步音量
    useEffect(() => {
      if (mediaRef.current) {
        mediaRef.current.volume = volume;
      }
    }, [volume, showVideo]);

    // 同步静音
    useEffect(() => {
      if (mediaRef.current) {
        mediaRef.current.muted = isMuted;
      }
    }, [isMuted, showVideo]);

    // 同步播放速度
    useEffect(() => {
      if (mediaRef.current) {
        mediaRef.current.playbackRate = playbackRate;
      }
    }, [playbackRate, showVideo]);

    const togglePlayPause = () => {
      if (mediaRef.current) {
        if (isPlaying) {
          mediaRef.current.pause();
        } else {
          mediaRef.current.play();
        }
      }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = parseFloat(e.target.value);
      if (mediaRef.current) {
        mediaRef.current.currentTime = time;
        setCurrentTime(time);
      }
    };

    const skipBackward = () => {
      if (mediaRef.current) {
        mediaRef.current.currentTime = Math.max(0, mediaRef.current.currentTime - 10);
      }
    };

    const skipForward = () => {
      if (mediaRef.current && duration) {
        mediaRef.current.currentTime = Math.min(duration, mediaRef.current.currentTime + 10);
      }
    };

    const formatTime = (seconds: number) => {
      if (isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
      <div className={clsx("media-player-real-box flex flex-col h-full min-h-0", className)}>
        {/* 视频显示区域 */}
        {showVideo ? (
          <div className="media-player-real-video-box flex-1 bg-black rounded-xl overflow-hidden mb-2.5">
            <video
              ref={videoRef}
              src={mediaUrl}
              className="w-full h-full object-contain"
              playsInline
            />
          </div>
        ) : (
          <div className="media-player-real-audio-box flex-1 min-h-0 flex-shrink rounded-2xl mb-2.5 border border-slate-100 bg-gradient-to-r from-white via-indigo-50 to-white p-4 text-slate-800 shadow-sm">
            <audio ref={audioRef} src={mediaUrl} className="hidden" />
            <div className="media-player-real-audio-box-header flex items-center justify-between min-h-0 gap-4">
              <div className="flex items-center gap-3 min-h-0">
                <button
                  onClick={togglePlayPause}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-md hover:bg-indigo-600 transition-colors"
                  title={isPlaying ? '暂停音频' : '播放音频'}
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>
                <div>
                  <p className="text-sm font-semibold text-slate-900">音频播放模式</p>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    {isPlaying ? '正在播放' : '点击播放按钮开始收听'}
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-500 min-h-0">
                {hasAudioPath ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-3 py-1 text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    已使用提取音频
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-amber-600 border border-amber-100">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    暂用原视频音轨
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 播放控制面板 */}
        <div className="media-player-real-control-box shrink-0 min-h-[120px] rounded-2xl border border-slate-100 bg-white p-4 space-y-4 shadow-sm">
          {/* 进度条 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-12 text-right">{formatTime(currentTime)}</span>
            <div className="flex-1">
              <input
                type="range"
                min="0"
                max={duration || 0}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-2 rounded-full bg-slate-100 accent-indigo-500 cursor-pointer"
              />
            </div>
            <span className="text-xs text-gray-500 w-12">{formatTime(duration)}</span>
          </div>

          {/* 控制按钮 */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={skipBackward}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
                title="后退10秒"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={togglePlayPause}
                className="p-3 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-300/50 transition-colors"
                title={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button
                onClick={skipForward}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
                title="前进10秒"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-4">
              {/* 音量控制 */}
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
                title={isMuted ? '取消静音' : '静音'}
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              {!isMuted && (
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-20 h-2 rounded-full bg-slate-100 accent-indigo-500 cursor-pointer"
                />
              )}

              {/* 播放速度 */}
              <select
                value={playbackRate}
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                title="播放速度"
              >
                <option value="0.5">0.5x</option>
                <option value="0.75">0.75x</option>
                <option value="1">1x</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2x</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

MediaPlayer.displayName = 'MediaPlayer';

export interface MediaPlayerPanelProps {
  projectId: number;
  projectName: string;
  duration?: number;
  isVideo: boolean;
  hasAudioPath: boolean; // 是否有提取的音频文件
  playerMode: 'audio' | 'video';
  onModeChange: (mode: 'audio' | 'video') => void;
  playerRef: React.RefObject<MediaPlayerRef>;
  onTimeUpdate?: (time: number) => void;
  className?: string;
}

export const MediaPlayerPanel: React.FC<MediaPlayerPanelProps> = ({
  projectId,
  duration,
  isVideo,
  hasAudioPath,
  playerMode,
  onModeChange,
  playerRef,
  onTimeUpdate,
  className
}) => {
  return (
    <div className={clsx("media-player-panel-box flex h-full flex-col rounded-xl border border-gray-100 bg-white p-6 shadow-sm overflow-hidden min-h-0", className)}>
      <div className="media-player-panel-header-box flex items-center justify-between pb-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <PlayCircle className="w-5 h-5 text-indigo-500" />
            播放器
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {duration ? `时长约 ${(duration / 60).toFixed(1)} 分钟` : '等待计算时长'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isVideo && (
            <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-1">
              <button
                onClick={() => onModeChange('audio')}
                className={clsx(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                  playerMode === 'audio'
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                音频
              </button>
              <button
                onClick={() => onModeChange('video')}
                className={clsx(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                  playerMode === 'video'
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                视频
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="media-player-panel-content-box flex-1 overflow-hidden">
        <MediaPlayer
          ref={playerRef}
          projectId={projectId}
          isVideo={isVideo}
          hasAudioPath={hasAudioPath}
          playerMode={playerMode}
          onTimeUpdate={onTimeUpdate}
          className="h-full"
        />
      </div>
    </div>
  );
};

