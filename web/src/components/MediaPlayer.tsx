import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
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

    // 统一的状态管理
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);

    // 模式切换状态追踪
    const previousModeRef = useRef<'audio' | 'video' | null>(null);
    const pendingRestoreRef = useRef<{ time: number; playing: boolean } | null>(null);

    // 预加载状态追踪
    const videoLoadedRef = useRef(false);
    const audioLoadedRef = useRef(false);

    const mediaRef = playerMode === 'video' && isVideo ? videoRef : audioRef;
    const showVideo = playerMode === 'video' && isVideo;

    // 构建媒体 URL
    const baseMediaUrl = `${getApiUrl()}/projects/${projectId}/media`;
    const videoUrl = baseMediaUrl;
    const audioUrl = hasAudioPath ? `${baseMediaUrl}?type=audio` : baseMediaUrl;

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        const media = mediaRef.current;
        if (media) {
          console.log(`[MediaPlayer] seekTo called: ${time}s, current mode: ${playerMode}`);
          media.currentTime = time;
          setCurrentTime(time);
        }
      },
      getCurrentTime: () => currentTime,
      play: () => {
        const media = mediaRef.current;
        if (media) {
          console.log(`[MediaPlayer] play() called, mode: ${playerMode}, readyState: ${media.readyState}`);
          media.play().catch(err => {
            console.error('[MediaPlayer] 播放失败:', err);
          });
        }
      },
      pause: () => {
        const media = mediaRef.current;
        if (media) {
          console.log(`[MediaPlayer] pause() called, mode: ${playerMode}`);
          media.pause();
        }
      },
    }), [playerMode, currentTime]);

    // 初始化预加载
    useEffect(() => {
      console.log(`[MediaPlayer] ========== 初始化预加载 ==========`);
      // 这里的逻辑主要是确保 src 被设置。
      // 因为我们移除了条件渲染，videoRef 和 audioRef 始终存在，所以可以直接设置

      if (videoRef.current && videoRef.current.src !== videoUrl) {
          videoRef.current.src = videoUrl;
      }

      if (audioRef.current && audioRef.current.src !== audioUrl) {
          audioRef.current.src = audioUrl;
      }
    }, [videoUrl, audioUrl]);

    // 尝试恢复状态
    const attemptRestoreState = useCallback((media: HTMLMediaElement, state: { time: number; playing: boolean }) => {
        console.log(`[MediaPlayer] 尝试恢复状态 - target: ${state.time}s, playing: ${state.playing}, readyState: ${media.readyState}`);

        // 设置时间
        // 注意：如果时间差异很小，不需要重新设置，避免不必要的 seek
        if (Math.abs(media.currentTime - state.time) > 0.5) {
             media.currentTime = state.time;
        }

        if (state.playing) {
            const playPromise = media.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    // 自动播放策略可能会阻止播放，或者媒体未就绪
                    console.warn("[MediaPlayer] 恢复播放失败 (可能是因为未加载完成):", error);
                    // 保持 pending 状态，等待 canplay
                });
            }
        } else {
            media.pause();
        }
    }, []);


    // 处理模式切换：保存状态并同步
    useEffect(() => {
      // 首次加载不触发切换逻辑
      if (previousModeRef.current === null) {
        previousModeRef.current = playerMode;
        return;
      }

      if (previousModeRef.current !== playerMode) {
        console.log(`[MediaPlayer] ========== 模式切换 ==========`);
        console.log(`[MediaPlayer] 从 ${previousModeRef.current} 切换到 ${playerMode}`);

        // 1. 获取旧媒体的状态
        let oldMedia: HTMLMediaElement | null = null;
        if (previousModeRef.current === 'video' && isVideo) {
          oldMedia = videoRef.current;
        } else {
          oldMedia = audioRef.current;
        }

        let savedTime = 0;
        let wasPlaying = false;

        if (oldMedia) {
          savedTime = oldMedia.currentTime;
          wasPlaying = !oldMedia.paused;

          // 暂停旧媒体
          oldMedia.pause();
          console.log(`[MediaPlayer] 旧媒体状态 - time: ${savedTime}s, playing: ${wasPlaying}`);
        }

        // 2. 准备恢复到新媒体
        const newMedia = playerMode === 'video' && isVideo ? videoRef.current : audioRef.current;

        if (newMedia) {
            // 同步当前时间显示（防止UI跳变）
            setCurrentTime(savedTime);
            setIsPlaying(wasPlaying);

            // 保存到 pending 引用，以便在 canplay 中使用（如果需要）
            pendingRestoreRef.current = { time: savedTime, playing: wasPlaying };

            // 如果新媒体已经就绪，立即尝试恢复
            if (newMedia.readyState >= 3) { // HAVE_FUTURE_DATA
                 attemptRestoreState(newMedia, { time: savedTime, playing: wasPlaying });
                 pendingRestoreRef.current = null; // 已处理
            } else {
                 // 如果未就绪，先设置时间（这有助于触发加载），具体的播放由事件监听器处理
                 newMedia.currentTime = savedTime;
                 console.log(`[MediaPlayer] 新媒体未就绪，等待加载...`);
            }
        }

        previousModeRef.current = playerMode;
      }
    }, [playerMode, isVideo, attemptRestoreState]);

    // 通用事件处理逻辑
    const setupMediaListeners = (
        media: HTMLMediaElement | null,
        mode: 'audio' | 'video',
        setLoadedRef: React.MutableRefObject<boolean>
    ) => {
        if (!media) return () => {};

        const handleLoadedMetadata = () => {
            console.log(`[MediaPlayer][${mode}] loadedmetadata: duration=${media.duration}`);
            setLoadedRef.current = true;
            if (playerMode === mode) {
                setDuration(media.duration || 0);
            }
        };

        const handleCanPlay = () => {
             // 检查是否有挂起的恢复任务
             if (playerMode === mode && pendingRestoreRef.current) {
                 console.log(`[MediaPlayer][${mode}] canplay - 执行挂起的恢复`);
                 attemptRestoreState(media, pendingRestoreRef.current);
                 pendingRestoreRef.current = null;
             }
        };

        const handleTimeUpdate = () => {
            if (playerMode === mode) {
                setCurrentTime(media.currentTime);
                onTimeUpdate?.(media.currentTime);
            }
        };

        const handlePlay = () => {
            if (playerMode === mode) {
                setIsPlaying(true);
                onPlay?.();
            }
        };

        const handlePause = () => {
            if (playerMode === mode) {
                // 只有当不是因为切换模式而造成的暂停时，才更新UI状态
                // 但这里很难区分。通常切换模式会立即激活另一个媒体的 play/pause 状态
                // 简单的做法是直接更新，React 的状态更新是批处理的，通常没问题
                setIsPlaying(false);
                onPause?.();
            }
        };

        const handleSeeked = () => {
             // 在 seek 完成后再次检查是否需要播放（处理某些浏览器行为）
             if (playerMode === mode && isPlaying && media.paused) {
                 media.play().catch(() => {});
             }
        };

        media.addEventListener('loadedmetadata', handleLoadedMetadata);
        media.addEventListener('canplay', handleCanPlay);
        media.addEventListener('timeupdate', handleTimeUpdate);
        media.addEventListener('play', handlePlay);
        media.addEventListener('pause', handlePause);
        media.addEventListener('seeked', handleSeeked);

        return () => {
            media.removeEventListener('loadedmetadata', handleLoadedMetadata);
            media.removeEventListener('canplay', handleCanPlay);
            media.removeEventListener('timeupdate', handleTimeUpdate);
            media.removeEventListener('play', handlePlay);
            media.removeEventListener('pause', handlePause);
            media.removeEventListener('seeked', handleSeeked);
        };
    };

    useEffect(() => {
        return setupMediaListeners(videoRef.current, 'video', videoLoadedRef);
    }, [playerMode, onTimeUpdate, onPlay, onPause, attemptRestoreState]);

    useEffect(() => {
        return setupMediaListeners(audioRef.current, 'audio', audioLoadedRef);
    }, [playerMode, onTimeUpdate, onPlay, onPause, attemptRestoreState]);

    // 同步属性（音量、静音、倍速）
    useEffect(() => {
        const syncProps = (media: HTMLMediaElement | null) => {
            if (media) {
                media.volume = volume;
                media.muted = isMuted;
                media.playbackRate = playbackRate;
            }
        };
        syncProps(videoRef.current);
        syncProps(audioRef.current);
    }, [volume, isMuted, playbackRate]);


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
        {/* 媒体展示区域 - 包含视频和音频UI */}
        <div className="flex-1 min-h-0 mb-2.5 relative bg-gray-50 rounded-xl overflow-hidden">

             {/* 视频元素 - 始终存在，通过 CSS 控制显示 */}
             <div className={clsx("w-full h-full bg-black flex items-center justify-center", !showVideo && "hidden")}>
                <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    playsInline
                    preload="auto"
                />
             </div>

             {/* 音频元素 - 始终存在，始终隐藏 (使用自定义 UI) */}
             <audio ref={audioRef} className="hidden" preload="auto" />

             {/* 音频模式 UI - 仅在音频模式显示 */}
             <div className={clsx("absolute inset-0 w-full h-full p-4", showVideo && "hidden")}>
                <div className="w-full h-full rounded-2xl border border-slate-100 bg-gradient-to-r from-white via-indigo-50 to-white p-4 text-slate-800 shadow-sm flex flex-col justify-between">

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
                                    <span className={clsx("inline-flex h-2 w-2 rounded-full", isPlaying ? "bg-emerald-400 animate-pulse" : "bg-gray-300")} />
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

                    {/* 音频模式下的额外可视化占位 */}
                    <div className="flex-1 flex items-center justify-center opacity-30">
                        <Volume2 className="w-24 h-24 text-indigo-300" />
                    </div>
                </div>
             </div>
        </div>

        {/* 播放控制面板 - 始终显示 */}
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
