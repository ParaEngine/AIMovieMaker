// ============ Help Modal ============

import { $ } from './utils.js';

const STORAGE_KEY = 'aimm_help_dismissed';

function createHelpModal() {
    const div = document.createElement('div');
    div.id = 'helpModal';
    div.className = 'fixed inset-0 bg-black/60 backdrop-filter backdrop-blur-sm z-50 flex items-center justify-center hidden';
    div.innerHTML = `
        <div class="card-flat fade-in" style="width:560px;max-height:80vh;overflow-y:auto;padding:28px">
            <div class="flex items-center justify-between mb-5">
                <h3 class="text-lg font-semibold" style="color:var(--text-primary)">📽️ AI Movie Maker 使用指南</h3>
                <span id="helpModalClose" class="cursor-pointer text-xl" style="color:var(--text-muted)">&times;</span>
            </div>
            <div style="color:var(--text-secondary);font-size:14px;line-height:1.8">
                <div class="mb-4">
                    <div class="font-semibold mb-1" style="color:var(--text-primary)">🚀 快速开始</div>
                    <ol style="padding-left:20px;list-style:decimal">
                        <li>登录你的 Keepwork 账号</li>
                        <li>点击 <b>"新建项目"</b>，输入项目名称</li>
                        <li>粘贴你的剧本或故事文本</li>
                        <li>点击 <b>"AI 分析剧本"</b>，AI 将自动拆解角色、场景和镜头</li>
                        <li>检查并编辑分镜 — 调整提示词、上传或用 AI 生成参考图</li>
                        <li>点击 <b>"开始生成视频"</b>，批量生成视频片段</li>
                        <li>所有片段完成后，预览你的 AI 电影！</li>
                    </ol>
                </div>
                <div class="mb-4">
                    <div class="font-semibold mb-1" style="color:var(--text-primary)">💡 小贴士</div>
                    <ul style="padding-left:20px;list-style:disc">
                        <li>上传角色和场景的参考图片可以显著提高生成质量</li>
                        <li>可以随时手动编辑每个镜头的提示词</li>
                        <li>项目会自动保存到你的 Keepwork 工作区</li>
                        <li>点击左侧 <b>🏠</b> 图标可以返回项目列表</li>
                    </ul>
                </div>
            </div>
            <div class="flex items-center justify-between mt-5 pt-4" style="border-top:1px solid var(--border)">
                <label class="flex items-center gap-2 cursor-pointer" style="font-size:13px;color:var(--text-muted)">
                    <input type="checkbox" id="helpDontShowAgain" style="accent-color:var(--accent)">
                    下次不再显示
                </label>
                <div class="flex items-center gap-3">
                    <a href="https://api.keepwork.com/ts-storage/siteFiles/49009/raw#1777378244052《智慧家教》 Making.mp4" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="padding:8px 14px;text-decoration:none">新手视频</a>
                    <a href="https://keepwork.com/maisi/maisi/webgames/tools/AIMovieMaker/docs/getting_started" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="padding:8px 14px;text-decoration:none">更多教学</a>
                    <button id="helpModalOk" class="btn-primary" style="padding:8px 24px">知道了</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(div);
    return div;
}

let modal = null;
function ensureModal() {
    if (!modal) modal = createHelpModal();
    return modal;
}

export function showHelpModal() {
    ensureModal();
    $('helpDontShowAgain').checked = false;
    $('helpModal').classList.remove('hidden');
}

export function hideHelpModal() {
    if (!modal) return;
    if ($('helpDontShowAgain').checked) {
        localStorage.setItem(STORAGE_KEY, '1');
    }
    $('helpModal').classList.add('hidden');
}

export function maybeShowHelpOnFirstUse() {
    if (!localStorage.getItem(STORAGE_KEY)) {
        showHelpModal();
    }
}

export function initHelp() {
    ensureModal();
    $('helpModal').onclick = (e) => { if (e.target === $('helpModal')) hideHelpModal(); };
    $('helpModalClose').onclick = hideHelpModal;
    $('helpModalOk').onclick = hideHelpModal;
    $('helpBtn').onclick = showHelpModal;
}
