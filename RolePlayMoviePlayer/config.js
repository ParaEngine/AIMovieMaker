// =================== 影视配音秀 — 游戏配置 ===================

export const GAME_SLUG = 'role-play-stories';
export const GAME_DISPLAY_TITLE = '影视配音秀';
export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 800;

// =================== 默认故事配置 ===================

// URL 参数 ?config=xxx 可指定自定义 JSON 配置
// 未指定时使用 stories/demo/config.json
export const DEFAULT_CONFIG_PATH = 'stories/demo/config.json';

// =================== DigitalHumanFrame 配置 ===================

// DHF YAML 配置文件路径（相对于游戏目录）
export const DHF_CONFIG_PATH = 'dhf-config.yaml';

// DHF 全屏容器宽高比（宽 / 高）, 根据角色设计调整，过宽或过窄都会导致画面留白
export const DHF_FULL_ASPECT_RATIO = 720 / 968;

// DHF 小头像仅显示容器顶部的高度比例（头像宽高比 = FULL_ASPECT_RATIO / PORTRAIT_HEIGHT_RATIO）
export const DHF_PORTRAIT_HEIGHT_RATIO = 1 / 2;

// =================== LLM Prompt 模板 ===================

export const PROMPTS = {
  // 配音判断 context 模板（通过 sendContext 发送给 LLM）
  judgeDubbing: (track) => `<current_sentence>
- nativeText: ${track.nativeText}
- targetText: ${track.targetText}
</current_sentence>
following is user voice:`,
};

// =================== 慢镜头参数 ===================

export const SLOWMO_CONFIG = {
  // 慢放速率（仅用于 forward 阶段实际视频推进）
  slowRate: 0.2,
  // 慢放循环持续时间（ms），倒退时间自动计算
  forwardDuration: 3000,
  // 配音时视频音量
  dubbingVolume: 0.05,
  // 正常播放音量
  normalVolume: 1.0,
  // 重试时预览秒数
  retryPreviewSeconds: 3,
  // 源视频假定帧率（实际采集率 = originalFPS * slowRate）
  originalFPS: 25,
  // 帧缓存：滑动窗口最大帧数
  // slowRate=0.1 → 2.5 FPS → 3s → 8帧; slowRate=0.5 → 12.5 FPS → 3s → 38帧
  maxCacheFrames: 60,
  // 帧缓存：图片最长边不超过此像素
  maxImageSide: 1024,
  // rewind 阶段插值回放帧率（屏幕绘制帧率）
  rewindDisplayFPS: 30,
};

// =================== 字幕参数 ===================

export const SUBTITLE_CONFIG = {
  // 字幕提前出现时间（秒）
  previewAheadSeconds: 3,
};

// =================== 计分配置 ===================

export const SCORING_CONFIG = {
  // 一次通过的加分
  firstPassScore: 100,
  // 重试后通过的加分（每次重试递减）
  retryPassScore: 60,
  // 每次重试扣分
  retryPenalty: 20,
  // 星级阈值
  stars: {
    three: 0,   // 总重试 0 次 = 3 星
    two: 3,     // 总重试 <= 3 次 = 2 星
    // 其余 = 1 星
  },
};
