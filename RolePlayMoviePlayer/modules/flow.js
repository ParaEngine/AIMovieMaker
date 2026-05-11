// =================== 影视配音秀 — 流程屏构建 ===================

/**
 * 构建介绍页 HTML
 * @param {string} [title] - 故事标题
 * @param {string} [description] - 故事描述
 */
export function buildIntroScreenHTML(title = '影视配音秀', description = '') {
  const desc = description || '观看视频片段，在配音环节跟读台词。<br>语音识别会判断你的配音是否匹配。<br>尽量流畅自然地朗读，一次通过获得最高评分！';
  return `
    <div class="rps-intro-screen" id="rpsIntroScreen">
      <div class="rps-intro-title">🎬 ${title}</div>
      <div class="rps-intro-desc">${desc}</div>
      <button type="button" class="rps-intro-start-btn" id="btnStartGame">
        开始配音
      </button>
    </div>
  `;
}

/**
 * 构建结果页 HTML
 * @param {Object} summary - {score, stars, passed, total, retries}
 */
export function buildResultScreenHTML(summary) {
  const starEmoji = '⭐'.repeat(summary.stars) + '☆'.repeat(3 - summary.stars);
  return `
    <div class="rps-result-screen" id="rpsResultScreen">
      <div class="rps-result-title">🎉 配音完成！</div>
      <div class="rps-result-stars">${starEmoji}</div>
      <div class="rps-result-stats">
        完成配音段：${summary.passed} / ${summary.total}<br>
        总分：${summary.score}<br>
        重试次数：${summary.retries}
      </div>
      <button type="button" class="rps-result-btn" id="btnReplay">
        再来一次
      </button>
    </div>
  `;
}

/**
 * 构建加载屏 HTML
 */
export function buildLoadingScreenHTML() {
  return `
    <div class="rps-loading-screen" id="rpsLoadingScreen">
      <div class="rps-intro-title">🎬 影视配音秀</div>
      <div class="rps-intro-desc" id="loadingStatus">加载中...</div>
    </div>
  `;
}
