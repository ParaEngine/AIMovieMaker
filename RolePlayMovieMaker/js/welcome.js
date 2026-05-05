// ============ Welcome modal (Chinese onboarding) ============
// Shown on first load. After dismissal, prompts login if the user is not
// signed in to Keepwork (mirrors the AIMovieMaker login-gate flow).

import { mountHTML } from './ui.js';
import { ensureKeepworkLogin, loadKeepworkSDK } from './kwsdk.js';
import { updateLoginButton } from './project.js';
import { log } from './utils.js';

const STORAGE_KEY = 'rpmm_welcome_dismissed_v1';

export function mountWelcomeUI() {
  if (document.getElementById('welcomeModal')) return;
  mountHTML(`
<div id="welcomeModal" role="dialog" aria-modal="true">
  <div class="wm-card">
    <h2>🎬 欢迎使用 角色扮演电影制作工具</h2>
    <div class="wm-sub">将一段视频拆解为<strong>角色 + 场景 + 字幕</strong>的结构化标注，用于二次创作或角色扮演练习。</div>

    <div class="wm-section">
      <h3>📋 五步流程</h3>
      <ol>
        <li><strong>选择源视频</strong>：上传 MP4 文件，或粘贴 YouTube / 直接视频链接。</li>
        <li><strong>解析视频</strong>：选择模型（Gemini 或 OpenRouter），调整提示词，让 AI 生成场景描述 JSON。</li>
        <li><strong>标注编辑器</strong>：在时间轴上预览并编辑生成的 JSON，可导出 .json 或 .srt 字幕。</li>
        <li><strong>生成互动</strong>：选择互动技能类型和玩学比，生成互动点（Interaction Points）。</li>
        <li><strong>预览</strong>：按最终互动电影布局播放，互动点暂停时显示 AI 数字人。</li>
      </ol>
    </div>

    <div class="wm-section">
      <h3>💡 小贴士</h3>
      <ul>
        <li>左侧侧边栏可随时切换阶段；底部 ⚙ 按钮配置 API Key 与默认模型。</li>
        <li>项目自动保存到你的 Keepwork 个人空间，可分享只读链接。</li>
        <li>右上角头像可切换登录状态。</li>
      </ul>
    </div>

    <div class="wm-actions">
      <label class="wm-skip">
        <input type="checkbox" id="wmDontShow" />
        下次不再显示
      </label>
      <div style="display:flex; gap:8px;">
        <button type="button" id="wmOk">开始使用</button>
      </div>
    </div>
  </div>
</div>`);
}

export function showWelcomeModal() {
  const m = document.getElementById('welcomeModal');
  if (m) m.classList.add('open');
}
export function hideWelcomeModal() {
  const m = document.getElementById('welcomeModal');
  if (m) m.classList.remove('open');
}

/* Initialize the modal: shown on first load (unless dismissed before).
 * After dismissal, if the user is not logged in, prompt for login. */
export function initWelcome() {
  mountWelcomeUI();

  const params = new URLSearchParams(location.search);
  const isShared = params.get('shareuser') && params.get('projectname');
  const dismissed = localStorage.getItem(STORAGE_KEY) === '1';

  document.getElementById('wmOk')?.addEventListener('click', async () => {
    if (document.getElementById('wmDontShow')?.checked) {
      localStorage.setItem(STORAGE_KEY, '1');
    }
    hideWelcomeModal();
    await promptLoginIfNeeded();
  });

  if (isShared) return; // Shared read-only mode — skip welcome + login gate.

  if (!dismissed) {
    showWelcomeModal();
  } else {
    // Already saw welcome before — still prompt login if needed.
    promptLoginIfNeeded();
  }
}

async function promptLoginIfNeeded() {
  const sdk = await loadKeepworkSDK().catch(() => null);
  if (!sdk) return;
  if (sdk.token) return;
  try {
    await ensureKeepworkLogin();
    updateLoginButton();
    log('登录成功。', 'ok');
  } catch (e) {
    log('登录已取消：' + (e.message || e), 'warn');
  }
}
