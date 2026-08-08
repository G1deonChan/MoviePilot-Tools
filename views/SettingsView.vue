<template>
  <div class="settings-root">
    <div v-if="!settingsReady" class="settings-loading" aria-busy="true">
      <div class="settings-loading-text">正在加载设置…</div>
    </div>
    <template v-else>
    <!-- 主题设置（含自定义背景） -->
    <el-card class="settings-card" shadow="hover">
      <div class="section-header">
        <div class="section-icon theme-icon">
          <svg viewBox="0 0 24 24"><path :d="mdiPaletteOutline" /></svg>
        </div>
        <div class="section-title-wrap">
          <div class="section-title">主题设置</div>
          <div class="section-subtitle">外观主题、自定义背景与站点图标</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-main">
          <div class="setting-title">主题模式</div>
          <div class="setting-desc">选择自动跟随系统、浅色或深色主题。</div>
        </div>
        <el-radio-group
          v-model="themeMode"
          size="small"
          class="theme-radio-group"
          @change="onThemeChange"
        >
          <el-radio-button value="auto">自动</el-radio-button>
          <el-radio-button value="light">浅色</el-radio-button>
          <el-radio-button value="dark">深色</el-radio-button>
        </el-radio-group>
      </div>

      <div class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">
            高清图标
            <span class="recommend-tag">可选</span>
          </div>
          <div class="setting-desc">
            <template v-if="iconPackMeta">
              已导入「{{ iconPackMeta.name }}」· {{ iconPackMeta.count }} 个图标 ·
              {{ formatIconPackSize(iconPackMeta.bytes) }}
            </template>
            <template v-else>
              选择 .zip 图标包（内含 icons/*.png）。未导入时使用站点/API 图标或首字母占位。
            </template>
          </div>
        </div>
        <div class="setting-btns">
          <el-button
            v-if="iconPackMeta"
            size="small"
            type="danger"
            plain
            :loading="iconPackAction === 'clear'"
            :disabled="iconPackBusy"
            @click="onClearIconPack"
          >
            清除
          </el-button>
          <el-button
            size="small"
            type="primary"
            :loading="iconPackAction === 'import'"
            :disabled="iconPackBusy"
            @click="onImportIconPack"
          >
            导入
          </el-button>
        </div>
      </div>

      <div class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">使用自定义背景</div>
          <div class="setting-desc">
            <span v-if="isDark" class="danger-text">深色主题下自动禁用自定义背景</span>
            <span v-else>启用后，插件将使用您设置的自定义背景图片。</span>
          </div>
        </div>
        <el-switch
          :model-value="isDark ? false : bgConfig.enabled"
          :disabled="isDark || bgSaving"
          :loading="bgSaving"
          @change="onBgEnabledChange"
        />
      </div>

      <template v-if="bgConfig.enabled && !isDark">
        <div class="setting-row interval-row">
          <div class="setting-main">
            <div class="setting-title">自定义图片</div>
            <div class="setting-desc">上传本地图片作为自定义背景（自动压缩）。</div>
          </div>
          <div class="setting-btns">
            <el-button
              v-if="bgState.image"
              size="small"
              type="danger"
              plain
              :loading="bgSaving"
              @click="onClearBackground"
            >
              清除
            </el-button>
            <el-button size="small" type="primary" :loading="bgSaving" @click="onPickBackground">
              选择图片
            </el-button>
          </div>
        </div>

        <div class="interval-select-row">
          <div class="setting-title">从 URL 获取</div>
          <div class="setting-desc">输入网络图片 URL，点击测试以下载并作为背景。</div>
          <div class="url-row">
            <el-input
              v-model="bgConfig.url"
              placeholder="https://example.com/image.jpg"
              size="small"
              :disabled="bgSaving || testingUrl"
            />
            <el-button size="small" type="primary" :loading="testingUrl" @click="onTestBgUrl">
              测试
            </el-button>
          </div>
        </div>

        <div class="setting-row interval-row">
          <div class="setting-main">
            <div class="setting-title">从 MoviePilot 获取壁纸</div>
            <div class="setting-desc">从 MP 服务器获取壁纸图片作为背景。</div>
          </div>
          <el-button
            size="small"
            type="primary"
            :loading="fetchingWallpapers"
            @click="onFetchMpWallpapers"
          >
            {{ mpWallpapers.length > 0 ? '刷新' : '获取' }}
          </el-button>
        </div>

        <div class="setting-row interval-row">
          <div class="setting-main">
            <div class="setting-title">自动获取每日壁纸</div>
            <div class="setting-desc">开启后，每天自动从 MP 获取当日电影海报作为背景。</div>
          </div>
          <el-switch
            v-model="dailyWallpaperEnabled"
            :loading="fetchingDaily"
            @change="onDailyWallpaperToggle"
          />
        </div>

        <div v-if="mpWallpapers.length > 0" class="mp-wallpaper-grid">
          <div
            v-for="(wp, idx) in mpWallpapers"
            :key="idx"
            class="mp-wallpaper-item"
            :class="{ active: wp === bgConfig.url }"
            @click="onSelectMpWallpaper(wp)"
          >
            <img :src="wp" :alt="'壁纸 ' + (idx + 1)" loading="lazy" />
          </div>
        </div>

        <div class="setting-row interval-row">
          <div class="setting-main">
            <div class="setting-title">模糊背景</div>
            <div class="setting-desc">启用后，将为背景图片添加高斯模糊效果。</div>
          </div>
          <el-switch
            v-model="bgConfig.blurEnabled"
            :loading="bgSaving"
            @change="saveBgConfig"
          />
        </div>

        <div v-if="bgConfig.blurEnabled" class="interval-select-row">
          <div class="slider-label">
            <span>模糊度</span>
            <span>{{ bgConfig.blur }}px</span>
          </div>
          <el-slider
            v-model="bgConfig.blur"
            :min="1"
            :max="20"
            :step="1"
            :disabled="bgSaving"
            @change="saveBgConfig"
          />
        </div>

        <div class="interval-select-row">
          <div class="slider-label">
            <span>不透明度</span>
            <span>{{ Math.round(bgConfig.opacity * 100) }}%</span>
          </div>
          <el-slider
            v-model="bgConfig.opacity"
            :min="0.1"
            :max="1"
            :step="0.05"
            :disabled="bgSaving"
            @change="saveBgConfig"
          />
        </div>
      </template>
    </el-card>

    <!-- 安全设置 -->
    <el-card class="settings-card" shadow="hover">
      <div class="section-header">
        <div class="section-icon">
          <svg viewBox="0 0 24 24"><path :d="mdiShieldLockOutline" /></svg>
        </div>
        <div class="section-title-wrap">
          <div class="section-title">安全设置</div>
          <div class="section-subtitle">保护扩展弹窗访问</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-main">
          <div class="setting-title">PIN 安全保护</div>
          <div class="setting-desc">启用后，打开 popup 需要输入 PIN 验证。</div>
        </div>
        <el-switch :model-value="pinSet" :loading="saving" @change="onPinSwitchChange" />
      </div>

      <div v-if="pinSet" class="frequency-block">
        <div class="setting-title">PIN 验证频率</div>
        <el-radio-group v-model="frequency" class="frequency-options" @change="onFrequencyChange">
          <el-radio value="session" class="frequency-option">
            <div class="frequency-content">
              <div class="frequency-title">浏览器关闭前无需验证</div>
              <div class="frequency-desc">本次浏览器会话内解锁一次即可。</div>
            </div>
          </el-radio>
          <el-radio value="always" class="frequency-option">
            <div class="frequency-content">
              <div class="frequency-title">每次打开都需要验证</div>
              <div class="frequency-desc">每次打开 popup 都要求输入 PIN。</div>
            </div>
          </el-radio>
        </el-radio-group>
        <div class="settings-actions">
          <el-button size="small" type="primary" plain @click="dialog = true">修改 PIN</el-button>
        </div>
      </div>
    </el-card>

    <!-- 网页嵌入功能设置控制 Content Script 功能注入。 -->
    <el-card class="settings-card" shadow="hover">
      <div class="section-header">
        <div class="section-icon embed-icon">
          <svg viewBox="0 0 24 24"><path :d="mdiPuzzleOutline" /></svg>
        </div>
        <div class="section-title-wrap">
          <div class="section-title">WEB 嵌入功能设置</div>
          <div class="section-subtitle">控制注入站点页面的增强功能</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-main">
          <div class="setting-title">页面保持</div>
          <div class="setting-desc">打开扩展时恢复到上次关闭前的页面；关闭时始终从站点管理开始。</div>
        </div>
        <el-switch
          v-model="webEmbed.pageKeepEnabled"
          :loading="webEmbedSaving"
          @change="saveWebEmbedConfigForm"
        />
      </div>

      <div class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">种子详情页一键下载</div>
          <div class="setting-desc">启用后在已配置 PT 站点的种子详情页显示悬浮下载按钮。</div>
        </div>
        <el-switch
          v-model="webEmbed.torrentDetailDownloadEnabled"
          :loading="webEmbedSaving"
          @change="saveWebEmbedConfigForm"
        />
      </div>

      <div class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">两步验证自动填充</div>
          <div class="setting-desc">在登录页自动匹配并填充两步验证码（需已配置对应站点 TOTP）。</div>
        </div>
        <el-switch
          v-model="webEmbed.totpAutoFillEnabled"
          :loading="webEmbedSaving"
          @change="saveWebEmbedConfigForm"
        />
      </div>

      <div class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">
            图片验证码自动填充
            <span class="recommend-tag">服务端识别</span>
          </div>
          <div class="setting-desc">在登录页识别图片验证码并填充（默认走服务端 OCR，可再开离线/AI）。</div>
        </div>
        <el-switch
          v-model="webEmbed.captchaAutoFillEnabled"
          :loading="webEmbedSaving"
          @change="saveWebEmbedConfigForm"
        />
      </div>

      <div v-if="webEmbed.captchaAutoFillEnabled" class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">
            离线 OCR
            <span class="recommend-tag">本地识别</span>
          </div>
          <div class="setting-desc">优先用本机离线包识别，不走远程服务</div>
        </div>
        <el-switch
          v-model="webEmbed.captchaOfflineOcrEnabled"
          :loading="webEmbedSaving"
          @change="saveWebEmbedConfigForm"
        />
      </div>

      <div v-if="webEmbed.captchaAutoFillEnabled" class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">
            AI 辅助识别
            <span class="speed-tag">提高准确率但速度较慢</span>
          </div>
          <div class="setting-desc">
            启用后优先检测 MoviePilot 智能助手状态，已启用时调用支持视觉的模型识别验证码。
          </div>
        </div>
        <el-switch
          v-model="webEmbed.captchaAiAssistEnabled"
          :loading="webEmbedSaving"
          @change="saveWebEmbedConfigForm"
        />
      </div>

      <div
        v-if="webEmbed.captchaAutoFillEnabled && webEmbed.captchaAiAssistEnabled"
        class="setting-row interval-row"
      >
        <div class="setting-main setting-main-stack">
          <div class="setting-title">API Token</div>
          <div class="setting-desc">
            MoviePilot 的 API_TOKEN（默认 moviepilot），用于 OpenAI 兼容接口认证。
          </div>
          <el-input
            v-model="apiTokenInput"
            class="api-token-input"
            type="password"
            show-password
            size="small"
            :placeholder="apiTokenPlaceholder"
            :disabled="webEmbedSaving"
            @change="saveApiToken"
            @focus="onApiTokenFocus"
            @blur="onApiTokenBlur"
          />
        </div>
      </div>
    </el-card>

    <!-- 离线 OCR：zip 导入运行时与模型；纠错词表同卡 -->
    <el-card class="settings-card" shadow="hover">
      <div class="section-header">
        <div class="section-icon ocr-icon">
          <svg viewBox="0 0 24 24"><path :d="mdiTextBoxCheckOutline" /></svg>
        </div>
        <div class="section-title-wrap">
          <div class="section-title">离线 OCR</div>
          <div class="section-subtitle">导入一次离线包，即可在本地识别验证码</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-main">
          <div class="setting-title">
            状态
            <span v-if="ocrRuntimeReady && ocrModels.length" class="recommend-tag">已就绪</span>
            <span v-else class="recommend-tag" style="opacity: 0.65">未就绪</span>
          </div>
          <div class="setting-desc">
            <template v-if="ocrRuntimeReady && ocrRuntimeMeta && ocrModels.length">
              WASM {{ formatRuntimeSize(ocrRuntimeMeta.totalSize) }} · 模型
              {{ ocrModels.length }} 个
            </template>
            <template v-else-if="ocrRuntimeReady && ocrRuntimeMeta">
              WASM 已就绪，还差模型
            </template>
            <template v-else-if="ocrModels.length">
              已有模型，还差 WASM
            </template>
            <template v-else>导入离线包后即可使用</template>
          </div>
        </div>
        <div class="setting-btns">
          <el-button
            v-if="ocrRuntimeReady"
            size="small"
            type="danger"
            plain
            :loading="ocrModelAction === 'clear-runtime'"
            :disabled="ocrModelBusy"
            @click="onClearOcrRuntime"
          >
            清除 WASM
          </el-button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-main">
          <div class="setting-title">导入离线包</div>
          <div class="setting-desc">选择离线包 zip 导入</div>
        </div>
        <div class="setting-btns">
          <el-button
            size="small"
            type="primary"
            :loading="ocrModelAction === 'import'"
            :disabled="ocrModelBusy"
            @click="onImportOcrPack"
          >
            导入
          </el-button>
        </div>
      </div>

      <div class="interval-select-row">
        <div class="setting-title">识别预设</div>
        <div class="setting-desc">一般保持 ddddocr 即可</div>
        <el-select v-model="ocrImportProfile" class="interval-select" size="small" :disabled="ocrModelBusy">
          <el-option
            v-for="p in ocrProfiles"
            :key="p.id"
            :label="p.label"
            :value="p.id"
          />
        </el-select>
      </div>

      <div
        v-if="!ocrRuntimeReady || !ocrModels.length"
        class="restore-empty"
        style="margin-top: 12px"
      >
        <template v-if="!ocrRuntimeReady && !ocrModels.length">
          还没导入离线包，导入后即可使用
        </template>
        <template v-else-if="!ocrRuntimeReady">
          模型已有，请再导入完整离线包补齐 WASM
        </template>
        <template v-else>
          WASM 已有，请再导入完整离线包补齐模型
        </template>
      </div>
      <div v-if="ocrModels.length" class="ocr-model-list">
        <div
          v-for="m in ocrModels"
          :key="m.id"
          class="ocr-model-item"
          :class="{ active: m.id === ocrActiveId }"
        >
          <div class="ocr-model-main">
            <div class="ocr-model-name">
              {{ m.name }}
              <span v-if="m.id === ocrActiveId" class="ocr-model-badge">使用中</span>
            </div>
            <div class="ocr-model-sub">
              {{ m.profile }} · {{ formatModelSize(m.size) }} · 词表 {{ m.labelCount }}
            </div>
          </div>
          <div class="setting-btns">
            <el-button
              size="small"
              :loading="ocrModelAction === `activate:${m.id}`"
              :disabled="m.id === ocrActiveId || ocrModelBusy"
              @click="onActivateOcrModel(m.id)"
            >
              启用
            </el-button>
            <el-button
              size="small"
              type="danger"
              plain
              :loading="ocrModelAction === `remove:${m.id}`"
              :disabled="ocrModelBusy"
              @click="onRemoveOcrModel(m.id)"
            >
              删除
            </el-button>
          </div>
        </div>
      </div>

      <div class="setting-row" style="margin-top: 8px">
        <div class="setting-main">
          <div class="setting-title">纠错词表</div>
          <div class="setting-desc">
            填充后点「纠正」可学习，当前 {{ correctionEntries.length }} 条
          </div>
        </div>
        <div class="setting-btns">
          <el-button size="small" @click="openCorrectionManager">管理</el-button>
          <el-button size="small" @click="onExportCorrections">导出</el-button>
          <el-button size="small" type="primary" @click="onImportCorrections">导入</el-button>
        </div>
      </div>
    </el-card>

    <el-dialog
      v-model="correctionDialog"
      title="验证码纠错词表"
      width="92%"
      class="pin-dialog correction-dialog"
      append-to-body
      align-center
      :lock-scroll="false"
      :close-on-click-modal="false"
    >
      <div class="pin-dialog-body">
        <p class="pin-dialog-desc">
          把识别错的内容改成正确结果；登录页点「纠正」也能添加。
        </p>

        <div class="correction-add-row">
          <el-input
            v-model="correctionDraftWrong"
            class="correction-field"
            size="small"
            placeholder="识别错误"
            clearable
          />
          <span class="correction-arrow" aria-hidden="true">→</span>
          <el-input
            v-model="correctionDraftRight"
            class="correction-field"
            size="small"
            placeholder="正确结果"
            clearable
            @keyup.enter="onAddCorrection"
          />
          <el-button
            class="correction-add-btn"
            size="small"
            type="primary"
            :loading="correctionBusy"
            :disabled="!correctionDraftWrong.trim() || !correctionDraftRight.trim()"
            @click="onAddCorrection"
          >
            添加
          </el-button>
        </div>

        <div v-if="!correctionEntries.length" class="restore-empty" style="margin-top: 12px">
          暂无词条。可在验证码填充 toast 点「纠正」，或上方手动添加。
        </div>
        <div v-else class="ocr-model-list correction-list" style="margin-top: 12px">
          <div v-for="item in correctionEntries" :key="item.wrong" class="ocr-model-item">
            <div class="ocr-model-main">
              <div class="ocr-model-name">
                {{ item.wrong }}
                <span class="correction-arrow-inline">→</span>
                {{ item.right }}
              </div>
              <div class="ocr-model-sub">识别原文映射为正确文本</div>
            </div>
            <div class="setting-btns">
              <el-button
                size="small"
                type="danger"
                plain
                :loading="correctionBusy"
                @click="onRemoveCorrection(item.wrong)"
              >
                删除
              </el-button>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="pin-dialog-footer">
          <el-button size="small" @click="onExportCorrections">导出</el-button>
          <el-button size="small" @click="onImportCorrections">导入</el-button>
          <el-button size="small" type="primary" @click="correctionDialog = false">完成</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- Cookie 和 UA 在每日首次运行及配置间隔到期时自动更新。 -->
    <el-card class="settings-card" shadow="hover">
      <div class="section-header">
        <div class="section-icon cookie-icon">
          <svg viewBox="0 0 24 24"><path :d="mdiCookieRefreshOutline" /></svg>
        </div>
        <div class="section-title-wrap">
          <div class="section-title">自动更新 Cookie 和 UserAgent</div>
          <div class="section-subtitle">同步浏览器登录状态到 MoviePilot</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-main">
          <div class="setting-title">
            每日首次更新
            <span class="recommend-tag">推荐</span>
          </div>
          <div class="setting-desc">启用后每天首次打开浏览器时自动更新。</div>
        </div>
        <el-switch
          v-model="cookieUa.dailyFirstEnabled"
          :loading="cookieUaSaving"
          @change="saveCookieUa"
        />
      </div>

      <div class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">定时更新</div>
          <div class="setting-desc">可设置定时检查自动更新的时间间隔。</div>
        </div>
        <el-switch
          v-model="cookieUa.intervalEnabled"
          :loading="cookieUaSaving"
          @change="saveCookieUa"
        />
      </div>

      <div v-if="cookieUa.intervalEnabled" class="interval-select-row">
        <div class="setting-title">定时检查间隔</div>
        <el-select
          v-model="cookieUa.intervalMinutes"
          class="interval-select"
          size="small"
          :disabled="cookieUaSaving"
          @change="saveCookieUa"
        >
          <el-option
            v-for="item in cookieUaIntervalPresets"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </div>

      <div class="settings-actions">
        <el-button size="small" type="primary" :loading="cookieUaSyncing" @click="onSyncNow">
          立即同步
        </el-button>
      </div>
    </el-card>

    <!-- 站点可在每月首次运行或配置时间到期时自动打开，并按设置关闭标签页。 -->
    <el-card class="settings-card" shadow="hover">
      <div class="section-header">
        <div class="section-icon open-icon">
          <svg viewBox="0 0 24 24"><path :d="mdiOpenInNew" /></svg>
        </div>
        <div class="section-title-wrap">
          <div class="section-title">自动打开站点</div>
          <div class="section-subtitle">按月或定时自动打开所有启用站点</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-main">
          <div class="setting-title">每月首次打开</div>
          <div class="setting-desc">启用后每月首次打开浏览器自动打开所有站点。</div>
        </div>
        <el-switch
          v-model="autoOpen.monthlyFirstEnabled"
          :loading="autoOpenSaving"
          @change="saveAutoOpen"
        />
      </div>

      <div class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">定时打开</div>
          <div class="setting-desc">可设置定时打开所有站点的时间间隔。</div>
        </div>
        <el-switch
          v-model="autoOpen.intervalEnabled"
          :loading="autoOpenSaving"
          @change="saveAutoOpen"
        />
      </div>

      <div v-if="autoOpen.intervalEnabled" class="interval-select-row">
        <div class="setting-title">定时打开间隔</div>
        <el-select
          v-model="autoOpen.intervalDays"
          class="interval-select"
          size="small"
          :disabled="autoOpenSaving"
          @change="saveAutoOpen"
        >
          <el-option
            v-for="item in siteOpenIntervalPresets"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </div>

      <div class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">自动关闭标签页</div>
          <div class="setting-desc">启用后，自动在打开指定时间后关闭自动打开的标签页。</div>
        </div>
        <el-switch
          v-model="autoOpen.autoCloseEnabled"
          :loading="autoOpenSaving"
          @change="saveAutoOpen"
        />
      </div>

      <div v-if="autoOpen.autoCloseEnabled" class="interval-select-row">
        <div class="setting-title">自动关闭时间</div>
        <el-select
          v-model="autoOpen.closeDelayMinutes"
          class="interval-select"
          size="small"
          :disabled="autoOpenSaving"
          @change="saveAutoOpen"
        >
          <el-option
            v-for="item in siteCloseDelayPresets"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </div>

      <div v-if="autoOpen.autoCloseEnabled" class="setting-row interval-row">
        <div class="setting-main">
          <div class="setting-title">保留未登录的站点</div>
          <div class="setting-desc">启用后，标题包含「登录」「登陆」等关键词的标签页将被保留。</div>
        </div>
        <el-switch
          v-model="autoOpen.keepLoginTabsEnabled"
          :loading="autoOpenSaving"
          @change="saveAutoOpen"
        />
      </div>

      <div class="settings-actions">
        <el-button size="small" type="primary" :loading="autoOpenRunning" @click="onOpenNow">
          立即打开
        </el-button>
      </div>
    </el-card>

    <!-- 统一备份设置 -->
    <el-card class="settings-card backup-settings-card" shadow="hover">
      <div class="section-header">
        <div class="section-icon backup-icon">
          <svg viewBox="0 0 24 24"><path :d="mdiBackupRestore" /></svg>
        </div>
        <div class="section-title-wrap">
          <div class="section-title">备份设置</div>
          <div class="section-subtitle">统一管理 MoviePilot 服务端与 WebDAV 备份</div>
        </div>
      </div>

      <div class="backup-auto-controls">
        <div class="setting-row interval-row">
          <div class="setting-main">
            <div class="setting-title">定时自动备份</div>
            <div class="setting-desc">按统一频率备份到所有已启用的备份服务。</div>
          </div>
          <el-switch v-model="backupAuto.enabled" :disabled="backupSettingsBusy" />
        </div>

        <div v-if="backupAuto.enabled" class="interval-select-row">
          <div class="setting-title">备份频率</div>
          <el-select
            v-model="backupAuto.intervalHours"
            class="interval-select"
            size="small"
            :disabled="backupSettingsBusy"
          >
            <el-option
              v-for="item in backupIntervalPresets"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>

        <div class="setting-row interval-row">
          <div class="setting-main">
            <div class="setting-title">新增站点时自动备份</div>
            <div class="setting-desc">新增两步验证站点或凭据后，备份到所有已启用的服务。</div>
          </div>
          <el-switch v-model="backupAuto.onChange" :disabled="backupSettingsBusy" />
        </div>
      </div>

      <div class="backup-key-settings">
        <div class="setting-main backup-key-copy">
          <div class="setting-title backup-key-title">
            恢复密钥
            <span class="recommend-tag backup-required-tag">敏感资产</span>
          </div>
          <div class="setting-desc">随机生成并通过 .mpkey 文件跨设备恢复，页面不会显示密钥内容。</div>
        </div>
        <span class="backup-key-status" :class="{ 'is-ready': backupKeyConfigured }">
          {{ backupKeyConfigured ? '已配置' : '未配置' }}
        </span>
        <div v-if="backupKeyId" class="backup-key-id">
          <span>密钥 ID</span>
          <strong>{{ backupKeyId }}</strong>
        </div>
        <div class="settings-actions backup-key-actions">
          <el-button
            v-if="!backupKeyConfigured"
            size="small"
            type="primary"
            :loading="backupKeySaving"
            :disabled="!pinSet"
            @click="requestBackupKeyAction('generate')"
          >
            生成并导出
          </el-button>
          <el-button
            v-else
            size="small"
            type="primary"
            :loading="backupKeySaving"
            :disabled="!pinSet"
            @click="requestBackupKeyAction('export')"
          >
            导出密钥文件
          </el-button>
          <el-button
            size="small"
            :disabled="!pinSet"
            @click="requestBackupKeyAction('import')"
          >
            导入密钥文件
          </el-button>
          <el-button
            v-if="backupKeyConfigured"
            size="small"
            type="danger"
            plain
            :disabled="!pinSet"
            @click="requestBackupKeyAction('regenerate')"
          >
            重新生成
          </el-button>
        </div>
        <div v-if="!pinSet" class="backup-key-warning">请先启用 PIN 安全保护，才能管理恢复密钥。</div>
        <div v-else class="backup-key-warning">.mpkey 是恢复备份的唯一凭证，取得文件即可恢复数据，请离线妥善保存且不要发送给他人。</div>
      </div>

      <section class="backup-source backup-source-divider">
        <div class="backup-source-header">
          <div class="backup-source-icon mp-backup-icon">
            <svg viewBox="0 0 24 24"><path :d="mdiServerNetwork" /></svg>
          </div>
          <div class="section-title-wrap">
            <div class="backup-source-title">MoviePilot 服务端</div>
            <div class="backup-source-subtitle">经 MoviePilotTools 插件同步到 MP 插件数据目录</div>
          </div>
          <el-switch
            v-model="mpBackup.enabled"
            class="backup-source-switch"
            :disabled="mpBackupBusy"
            aria-label="启用 MoviePilot 服务端备份"
            @change="onMpBackupEnabledChange"
          />
        </div>

      <template v-if="mpBackup.enabled">
        <div class="setting-row interval-row retain-count-row">
          <div class="setting-main">
            <div class="setting-title">保留份数</div>
            <div class="setting-desc">超过份数后自动清理最旧备份，0 表示不清理。</div>
          </div>
          <el-input-number
            v-model="mpBackup.retainCount"
            class="retain-count-input"
            :min="0"
            :step="1"
            controls-position="right"
            :disabled="mpBackupBusy"
          />
        </div>
      </template>

      <div v-if="mpBackup.enabled" class="backup-content-select">
        <div class="setting-title backup-content-title">备份内容</div>
        <el-checkbox-group v-model="mpBackup.contents" class="backup-content-options">
          <el-checkbox
            v-for="item in MP_BACKUP_CONTENT_OPTIONS"
            :key="item.value"
            :value="item.value"
            :disabled="mpBackupBusy"
          >
            {{ item.label }}
          </el-checkbox>
        </el-checkbox-group>
      </div>

      <div
        v-if="mpBackupStatus"
        class="backup-result"
        :class="mpBackupStatusOk ? 'is-success' : 'is-error'"
        role="status"
      >
        <div class="backup-result-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path :d="mpBackupStatusOk ? mdiCheckCircleOutline : mdiAlertCircleOutline" />
          </svg>
        </div>
        <div class="backup-result-copy">
          <div class="backup-result-title">{{ mpBackupStatusOk ? '备份完成' : '备份失败' }}</div>
          <div class="backup-result-desc">{{ mpBackupStatus }}</div>
        </div>
      </div>
      <el-alert v-else type="info" :closable="false" class="webdav-tip" show-icon effect="light">
        表单修改后自动保存。备份内容使用统一备份密钥加密，不含 Token/PIN。
      </el-alert>

      <div
        v-if="mpBackupProgress"
        class="backup-progress backup-progress--mp"
        :class="{
          'is-indeterminate': mpBackupProgress.indeterminate,
          'is-success': mpBackupProgress.phase === 'completed',
          'is-error': mpBackupProgress.phase === 'failed',
        }"
      >
        <div class="backup-progress-head">
          <span class="backup-progress-label">{{ mpBackupProgress.label }}</span>
          <span class="backup-progress-percent">{{ mpBackupProgress.percent }}%</span>
        </div>
        <el-progress
          :percentage="mpBackupProgress.percent"
          :show-text="false"
          :stroke-width="4"
          :status="backupProgressStatus(mpBackupProgress)"
        />
        <div v-if="progressBytesLabel(mpBackupProgress) || progressChunkLabel(mpBackupProgress)" class="backup-progress-meta">
          <span>{{ progressBytesLabel(mpBackupProgress) }}</span>
          <span>{{ progressChunkLabel(mpBackupProgress) }}</span>
        </div>
      </div>

      <div class="settings-actions webdav-actions">
        <el-button
          size="small"
          :loading="mpBackupAction === 'check'"
          :disabled="mpBackupBusy || !mpBackup.enabled"
          @click="onCheckMpBackup"
        >
          检测连接
        </el-button>
        <el-button
          size="small"
          :loading="mpBackupAction === 'restore'"
          :disabled="mpBackupBusy || !mpBackup.enabled"
          @click="onRestoreMp"
        >
          还原
        </el-button>
        <el-button
          size="small"
          type="primary"
          :loading="mpBackupAction === 'backup'"
          :disabled="mpBackupBusy || !mpBackup.enabled"
          @click="onBackupMpNow"
        >
          立即备份
        </el-button>
      </div>
      </section>

      <section class="backup-source backup-source-divider">
        <div class="backup-source-header">
          <div class="backup-source-icon webdav-icon">
            <svg viewBox="0 0 24 24"><path :d="mdiCloudUploadOutline" /></svg>
          </div>
          <div class="section-title-wrap">
            <div class="backup-source-title">WebDAV 备份</div>
            <div class="backup-source-subtitle">将两步验证和凭据备份保存到 WebDAV</div>
          </div>
          <el-switch
            v-model="webdav.enabled"
            class="backup-source-switch"
            @change="onWebDavEnabledChange"
            :disabled="webdavBusy"
            aria-label="启用 WebDAV 备份"
          />
        </div>

      <el-form v-if="webdav.enabled" label-position="top" size="small" class="webdav-form">
        <el-form-item label="服务器地址" required>
          <el-input
            v-model="webdav.url"
            placeholder="https://dav.example.com/backups"
            :disabled="webdavBusy"
          />
        </el-form-item>

        <div class="row-two">
          <el-form-item label="备份路径" class="half">
            <el-input
              v-model="webdav.path"
              placeholder="/MP-Totp"
              :disabled="webdavBusy"
            />
          </el-form-item>
          <el-form-item label="保留份数" class="half">
            <el-input-number
              v-model="webdav.retainCount"
              :min="0"
              :step="1"
              controls-position="right"
              :disabled="webdavBusy"
              style="width: 100%"
            />
          </el-form-item>
        </div>

        <div class="row-two">
          <el-form-item label="用户名" class="half" required>
            <el-input
              v-model="webdav.username"
              placeholder="用户名"
              :disabled="webdavBusy"
            />
          </el-form-item>
          <el-form-item label="密码" class="half" required>
            <el-input
              v-model="webdav.password"
              type="password"
              show-password
              placeholder="密码"
              :disabled="webdavBusy"
            />
          </el-form-item>
        </div>
      </el-form>

      <template v-if="webdav.enabled">
        <div class="backup-content-select">
          <div class="setting-title backup-content-title">备份内容</div>
          <el-checkbox-group v-model="webdav.contents" class="backup-content-options">
            <el-checkbox
              v-for="item in WEBDAV_BACKUP_CONTENT_OPTIONS"
              :key="item.value"
              :value="item.value"
              :disabled="webdavBusy"
            >
              {{ item.label }}
            </el-checkbox>
          </el-checkbox-group>
        </div>

        <el-alert type="info" :closable="false" class="webdav-tip" show-icon effect="light">
          表单修改后自动保存。备份使用统一恢复密钥加密，需在扩展后台运行时才能按时执行。

        </el-alert>
      </template>

      <div
        v-if="webdavProgress"
        class="backup-progress backup-progress--webdav"
        :class="{
          'is-indeterminate': webdavProgress.indeterminate,
          'is-success': webdavProgress.phase === 'completed',
          'is-error': webdavProgress.phase === 'failed',
        }"
      >
        <div class="backup-progress-head">
          <span class="backup-progress-label">{{ webdavProgress.label }}</span>
          <span class="backup-progress-percent">{{ webdavProgress.percent }}%</span>
        </div>
        <el-progress
          :percentage="webdavProgress.percent"
          :show-text="false"
          :stroke-width="4"
          :status="backupProgressStatus(webdavProgress)"
        />
        <div v-if="progressBytesLabel(webdavProgress)" class="backup-progress-meta">
          <span>{{ progressBytesLabel(webdavProgress) }}</span>
        </div>
      </div>

      <div v-if="webdav.enabled" class="settings-actions webdav-actions">
        <el-button size="small" :loading="webdavAction === 'test'" :disabled="webdavBusy" @click="onTestWebDav">
          测试连接
        </el-button>
        <el-button
          size="small"
          :loading="webdavAction === 'restore'"
          :disabled="webdavBusy || !webdav.enabled"
          @click="onRestore"
        >
          还原
        </el-button>
        <el-button
          size="small"
          type="primary"
          :loading="webdavAction === 'backup'"
          :disabled="webdavBusy || !webdav.enabled"
          @click="onBackupNow"
        >
          立即备份
        </el-button>
      </div>
      </section>
    </el-card>

    <!-- 备份列表选择（WebDAV / MoviePilot） -->
    <el-dialog
      v-model="restoreDialog"
      :title="restoreSource === 'mp' ? '还原 MoviePilot 备份' : '还原 WebDAV 备份'"
      width="96%"
      class="pin-dialog restore-dialog"
      append-to-body
      align-center
      :lock-scroll="false"
      :close-on-click-modal="false"
      :close-on-press-escape="!restoreApplying"
      :show-close="!restoreApplying"
      @closed="onRestoreDialogClosed"
    >
      <div class="restore-dialog-body">
        <p class="restore-dialog-desc">选择一个备份快照，并勾选需要恢复的内容。</p>

        <div v-if="restoreLoading" class="restore-empty">正在读取备份快照…</div>
        <div v-else-if="!restoreItems.length" class="restore-empty">暂无可用备份</div>
        <template v-else>
          <div class="restore-section-title">备份快照</div>
          <div class="restore-list">
            <button
              v-for="item in restoreItems"
              :key="item.id"
              type="button"
              class="restore-item"
              :class="{ active: restoreSelected === item.id }"
              @click="restoreSelected = item.id"
            >
              <div class="restore-item-main">
                <div class="restore-item-name">{{ item.label }}</div>
                <div class="restore-item-sub">{{ item.contents.length }} 项内容</div>
              </div>
              <div class="restore-item-check" :class="{ on: restoreSelected === item.id }">
                <span v-if="restoreSelected === item.id">✓</span>
              </div>
            </button>
          </div>

          <template v-if="selectedRestoreItem">
            <div class="restore-config-section">
              <div class="restore-section-head">
                <div class="restore-section-title">恢复内容</div>
                <span>{{ restoreContents.length }}/{{ selectedRestoreItem.contents.length }}</span>
              </div>
              <el-checkbox-group v-model="restoreContents" class="backup-content-options restore-content-options">
                <el-checkbox
                  v-for="contentId in selectedRestoreItem.contents"
                  :key="contentId"
                  :value="contentId"
                >
                  {{ BACKUP_CONTENT_LABELS[contentId] }}
                </el-checkbox>
              </el-checkbox-group>
            </div>

            <div class="restore-config-section">
              <div class="restore-section-title">恢复策略</div>
              <el-radio-group v-model="restoreMode" class="restore-mode-options">
                <el-radio value="replace">替换所选领域</el-radio>
                <el-radio value="merge">合并可合并数据</el-radio>
              </el-radio-group>
            </div>

            <div class="restore-note">Token、当前会话、设备密钥和解锁状态不会恢复，完成后需要重新登录。</div>

            <div
              v-if="restoreApplying && activeRestoreProgress"
              class="backup-progress restore-progress"
              :class="{
                'backup-progress--mp': restoreSource === 'mp',
                'backup-progress--webdav': restoreSource === 'webdav',
                'is-indeterminate': activeRestoreProgress.indeterminate,
                'is-success': activeRestoreProgress.phase === 'completed',
                'is-error': activeRestoreProgress.phase === 'failed',
              }"
            >
              <div class="backup-progress-head">
                <span class="backup-progress-label">{{ activeRestoreProgress.label }}</span>
                <span class="backup-progress-percent">{{ activeRestoreProgress.percent }}%</span>
              </div>
              <el-progress
                :percentage="activeRestoreProgress.percent"
                :show-text="false"
                :stroke-width="4"
                :status="backupProgressStatus(activeRestoreProgress)"
              />
              <div v-if="progressBytesLabel(activeRestoreProgress) || progressChunkLabel(activeRestoreProgress)" class="backup-progress-meta">
                <span>{{ progressBytesLabel(activeRestoreProgress) }}</span>
                <span>{{ progressChunkLabel(activeRestoreProgress) }}</span>
              </div>
            </div>
          </template>
        </template>
      </div>
      <template #footer>
        <div class="pin-dialog-footer">
          <el-button size="small" :disabled="restoreApplying" @click="restoreDialog = false">取消</el-button>
          <el-button
            size="small"
            type="primary"
            :loading="restoreApplying"
            :disabled="!restoreSelected || !restoreContents.length || restoreLoading || !restoreItems.length"
            @click="onConfirmRestoreSelected"
          >
            开始还原
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="disablePinDialog"
      title="关闭 PIN 安全保护"
      width="92%"
      class="pin-dialog"
      append-to-body
      align-center
      :lock-scroll="false"
      :close-on-click-modal="false"
      @opened="onDisablePinDialogOpened"
      @closed="onDisablePinDialogClosed"
    >
      <div class="pin-dialog-body">
        <p class="pin-dialog-desc">
          请输入当前 6 位 PIN。验证通过后将关闭 PIN 安全保护。
        </p>

        <div class="pin-field">
          <div class="pin-field-label">当前 PIN</div>
          <PinInput ref="currentPinInputRef" v-model="currentPin" @enter="onClosePin" />
        </div>
      </div>

      <template #footer>
        <div class="pin-dialog-footer">
          <el-button size="small" @click="disablePinDialog = false">取消</el-button>
          <el-button size="small" type="danger" :loading="saving" @click="onClosePin">
            验证并关闭
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="dialog"
      :title="pinSet ? '修改 PIN' : '启用 PIN 安全保护'"
      width="92%"
      class="pin-dialog"
      append-to-body
      align-center
      :lock-scroll="false"
      :close-on-click-modal="false"
      @opened="onPinDialogOpened"
      @closed="onPinDialogClosed"
    >
      <div class="pin-dialog-body">
        <p class="pin-dialog-desc">
          {{ pinSet ? '请输入新的 6 位 PIN，并再次确认。' : '设置 6 位数字 PIN，用于保护弹窗访问。' }}
        </p>

        <div class="pin-field">
          <div class="pin-field-label">设置 PIN</div>
          <PinInput ref="pinInputRef" v-model="pin" @enter="focusConfirm" @complete="focusConfirm" />
        </div>

        <div class="pin-field">
          <div class="pin-field-label">确认 PIN</div>
          <PinInput ref="confirmInputRef" v-model="confirmPin" @enter="onSetPin" />
        </div>

        <div class="pin-field">
          <div class="pin-field-label">验证频率</div>
          <el-radio-group v-model="frequency" class="pin-freq-group">
            <el-radio value="session" class="pin-freq-opt">
              <div class="pin-freq-text">
                <div class="pin-freq-title">会话内</div>
                <div class="pin-freq-desc">浏览器关闭前无需再验证</div>
              </div>
            </el-radio>
            <el-radio value="always" class="pin-freq-opt">
              <div class="pin-freq-text">
                <div class="pin-freq-title">每次</div>
                <div class="pin-freq-desc">每次打开都需要验证</div>
              </div>
            </el-radio>
          </el-radio-group>
        </div>
      </div>

      <template #footer>
        <div class="pin-dialog-footer">
          <el-button size="small" @click="cancelPinDialog">取消</el-button>
          <el-button size="small" type="primary" :loading="saving" @click="onSetPin">
            {{ pinSet ? '保存' : '启用' }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-card class="settings-card" shadow="hover">
      <div class="section-header">
        <div class="section-title-wrap">
          <div class="local-data-title-row">
            <div class="section-title">本地数据管理</div>
            <span class="danger-operation-tag">危险操作</span>
          </div>
          <div class="section-subtitle">敏感数据、公共设置与缓存资产分离清理</div>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-main">
          <div class="setting-title">缓存与资产</div>
          <div class="setting-desc">清除缓存、自定义背景、高清图标包和离线 OCR 资产，不影响账号与凭据。</div>
        </div>
        <el-button
          size="small"
          :loading="localDataAction === 'cache'"
          :disabled="!pinSet"
          :title="pinSet ? '需要验证 PIN' : '请先设置 PIN 安全保护'"
          @click="requestLocalDataAction('cache')"
        >
          清空缓存/资产
        </el-button>
      </div>
      <div class="setting-row">
        <div class="setting-main">
          <div class="setting-title">全部本地数据</div>
          <div class="setting-desc">删除 Public、Private、Device、Assets、Cache 五个存储键以及本地资产库。</div>
        </div>
        <el-button
          size="small"
          type="danger"
          :loading="localDataAction === 'all'"
          :disabled="!pinSet"
          :title="pinSet ? '需要验证 PIN' : '请先设置 PIN 安全保护'"
          @click="requestLocalDataAction('all')"
        >
          清空本地数据
        </el-button>
      </div>
      <div v-if="!pinSet" class="local-data-pin-hint">请先在上方启用 PIN 安全保护，才能执行本地数据清理。</div>
    </el-card>

    <el-dialog
      v-model="backupKeyPinDialog"
      title="验证 PIN"
      width="92%"
      class="pin-dialog"
      append-to-body
      align-center
      :lock-scroll="false"
      :close-on-click-modal="false"
      @opened="onBackupKeyPinDialogOpened"
      @closed="onBackupKeyPinDialogClosed"
    >
      <div class="pin-dialog-body">
        <p class="pin-dialog-desc">恢复密钥属于敏感资产。请输入当前 6 位 PIN 授权本次操作。</p>
        <div class="pin-field">
          <div class="pin-field-label">当前 PIN</div>
          <PinInput ref="backupKeyPinInputRef" v-model="backupKeyPin" @enter="onConfirmBackupKeyPin" />
        </div>
      </div>
      <template #footer>
        <div class="pin-dialog-footer">
          <el-button size="small" @click="backupKeyPinDialog = false">取消</el-button>
          <el-button size="small" type="primary" :loading="backupKeySaving" @click="onConfirmBackupKeyPin">
            验证并继续
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="dangerPinDialog"
      title="验证 PIN"
      width="92%"
      class="pin-dialog"
      append-to-body
      align-center
      :lock-scroll="false"
      :close-on-click-modal="false"
      @opened="onDangerPinDialogOpened"
      @closed="onDangerPinDialogClosed"
    >
      <div class="pin-dialog-body">
        <p class="pin-dialog-desc">此操作会清理本地数据。请输入当前 6 位 PIN 继续。</p>
        <div class="pin-field">
          <div class="pin-field-label">当前 PIN</div>
          <PinInput ref="dangerPinInputRef" v-model="dangerPin" @enter="onConfirmDangerPin" />
        </div>
      </div>
      <template #footer>
        <div class="pin-dialog-footer">
          <el-button size="small" @click="dangerPinDialog = false">取消</el-button>
          <el-button size="small" type="danger" :loading="Boolean(localDataAction)" @click="onConfirmDangerPin">
            验证并继续
          </el-button>
        </div>
      </template>
    </el-dialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import {
  mdiPaletteOutline,
  mdiShieldLockOutline,
  mdiTextBoxCheckOutline,
  mdiCookieRefreshOutline,
  mdiOpenInNew,
  mdiPuzzleOutline,
  mdiBackupRestore,
  mdiServerNetwork,
  mdiCloudUploadOutline,
  mdiCheckCircleOutline,
  mdiAlertCircleOutline,
} from '@mdi/js'
import { ElMessage, confirmAction } from '../utils/ui'
import PinInput from '../components/PinInput.vue'
import { hasPin, setPin, setPinFrequency, pinFrequency, disablePin, unlock, verifyPin } from '../services/credential'
import {
  exportCorrections,
  importCorrections,
  listCorrections,
  upsertCorrection,
  removeCorrection,
  type CorrectionEntry,
} from '../services/captcha'
import {
  listOcrModels,
  getActiveOcrModel,
  removeOcrModel,
  setActiveOcrModel,
  formatModelSize,
  OCR_PROFILE_LIST,
  type OcrModelMeta,
  type OcrProfileId,
} from '../services/ocr-models'
import {
  getOcrRuntimeStatus,
  importOcrOfflinePack,
  clearOcrRuntime,
  formatRuntimeSize,
  type OcrRuntimeMeta,
} from '../services/ocr-runtime'
import { MSG, sendMessage } from '../core/bus'
import {
  getIconPackMeta,
  importIconPackFromZip,
  clearIconPack,
  formatIconPackSize,
  type SiteIconPackMeta,
} from '../services/site-icon-pack'
import {
  loadWebDavConfig,
  saveWebDavConfig,
  listBackups,
  restoreBackup,
  testWebDavConnection,
  type WebDavConfig,
} from '../services/webdav'
import {
  loadMpBackupConfig,
  saveMpBackupConfig,
  listMpBackups,
  restoreFromMp,
  checkMpBackupReady,
  MP_BACKUP_INTERVAL_HOUR_PRESETS,
  type MpBackupConfig,
} from '../services/mp-backup'
import {
  RECOVERY_KEY_FILE_ACCEPT,
  RECOVERY_KEY_FILE_MAX_BYTES,
  createRecoveryKeyFile,
  generateBackupKey,
  loadBackupKey,
  parseRecoveryKeyFile,
  recoveryKeyFileName,
  saveBackupKey,
} from '../services/backup-key'
import type { BackupProgress, RestoreMode } from '../services/backup-schema'
import type { BackupJobState, BackupJobTarget } from '../services/backup-job'
import { clearAllStores, clearCache } from '../core/store-repository'
import { clearAssetRepository } from '../core/asset-repository'
import { STORAGE_KEYS, storageGet, storageRemove, storageSet } from '../core/storage'


import {
  MP_BACKUP_CONTENT_OPTIONS,
  WEBDAV_BACKUP_CONTENT_OPTIONS,
  DEFAULT_BACKUP_CONTENTS,
  type BackupContentId,
} from '../services/backup-schema'
import {
  BACKUP_CONTENT_LABELS,
  type BackupSnapshotSummary,
} from '../services/backup-snapshot'
import {
  loadCookieUaConfig,
  saveCookieUaConfig,
  syncCookieUa,
  COOKIE_UA_INTERVAL_PRESETS,
  type CookieUaConfig,
} from '../services/cookie-sync'
import {
  loadSiteAutoOpenConfig,
  saveSiteAutoOpenConfig,
  openAllSites,
  SITE_AUTO_OPEN_INTERVAL_PRESETS,
  SITE_AUTO_CLOSE_DELAY_PRESETS,
  type SiteAutoOpenConfig,
} from '../services/site-auto-open'
import { downloadText } from '../utils/file'
import {
  consumePickedPageFiles,
  requestFilesFromActivePage,
  type PickedPageFile,
} from '../core/page-file-picker'
import {
  bgState,
  themeState,
  applyTheme,
  loadCustomBgConfig,
  saveCustomBgConfig,
  clearCustomBgImage,
  compressAndResizeImage,
  downloadAndCompressImage,
  applyImageAsBackground,
  fetchMpWallpapers,
  fetchDailyWallpaper,
  isDailyWallpaperEnabled,
  setDailyWallpaperEnabled,
  type CustomBgConfig,
  DEFAULT_CUSTOM_BG_CONFIG,
} from '../core/theme'
import {
  DEFAULT_WEB_EMBED_FEATURES,
  getWebEmbedFeaturesConfig,
  saveWebEmbedFeaturesConfig,
  type WebEmbedFeaturesConfig,
} from '../core/web-embed-features'

const pinSet = ref(false)
const dialog = ref(false)
const disablePinDialog = ref(false)
const pin = ref('')
const confirmPin = ref('')
const currentPin = ref('')
const dangerPinDialog = ref(false)
const dangerPin = ref('')
const pendingLocalDataAction = ref<'cache' | 'all' | null>(null)
const pinInputRef = ref<{ focus?: () => void } | null>(null)
const confirmInputRef = ref<{ focus?: () => void } | null>(null)
const currentPinInputRef = ref<{ focus?: () => void } | null>(null)
const dangerPinInputRef = ref<{ focus?: () => void } | null>(null)
const frequency = ref<'session' | 'always'>('session')
const saving = ref(false)
/** 与顶栏 ThemeToggle 共用 themeState，切换后双向同步 */
const isDark = computed(() => themeState.resolved === 'dark')
const themeMode = computed({
  get: () => themeState.pref,
  set: (v: 'light' | 'dark' | 'auto') => {
    void applyTheme(v)
  },
})

/** 离线 OCR 模型清单（wasm/模型由 zip 导入） */
const correctionDialog = ref(false)
const correctionBusy = ref(false)
const correctionEntries = ref<CorrectionEntry[]>([])
const correctionDraftWrong = ref('')
const correctionDraftRight = ref('')
const ocrModels = ref<OcrModelMeta[]>([])
const ocrActiveId = ref<string | null>(null)
/** 仅当前 OCR 操作按钮显示 loading，避免同行按钮同时加图标闪烁 */
const ocrModelAction = ref('')
const ocrModelBusy = computed(() => Boolean(ocrModelAction.value))
const ocrImportProfile = ref<OcrProfileId>('ddddocr')
const ocrProfiles = OCR_PROFILE_LIST
const ocrRuntimeReady = ref(false)
const ocrRuntimeMeta = ref<OcrRuntimeMeta | null>(null)
const iconPackMeta = ref<SiteIconPackMeta | null>(null)
const iconPackAction = ref('')
const iconPackBusy = computed(() => Boolean(iconPackAction.value))
const localDataAction = ref<'' | 'cache' | 'all'>('')

/** 读取和保存网页 Content Script 功能开关。 */
const webEmbed = reactive<WebEmbedFeaturesConfig>({ ...DEFAULT_WEB_EMBED_FEATURES })
const webEmbedSaving = ref(false)
const apiTokenInput = ref('')
const apiTokenPlaceholder = ref('moviepilot')
const apiTokenRaw = ref('')

const bgConfig = reactive<CustomBgConfig>({ ...DEFAULT_CUSTOM_BG_CONFIG })
const bgSaving = ref(false)
const testingUrl = ref(false)
const fetchingWallpapers = ref(false)
const mpWallpapers = ref<string[]>([])
const dailyWallpaperEnabled = ref(false)
const fetchingDaily = ref(false)

const webdav = ref<WebDavConfig>({
  enabled: false,
  url: '',
  path: '',
  username: '',
  password: '',
  autoEnabled: false,
  intervalHours: 24,
  autoOnChange: false,
  retainCount: 5,
  contents: [...DEFAULT_BACKUP_CONTENTS] as BackupContentId[],
})
const webdavAction = ref('')
const webdavBusy = computed(() => Boolean(webdavAction.value))
const webdavProgress = ref<BackupProgress | null>(null)
/** 加载/重置时跳过自动保存，避免回写触发 watch */
let webdavSkipAutoSave = false
let webdavSaveTimer: ReturnType<typeof setTimeout> | null = null

const mpBackup = ref<MpBackupConfig>({
  enabled: false,
  autoEnabled: false,
  intervalHours: 24,
  autoOnChange: false,
  retainCount: 5,
  contents: [...DEFAULT_BACKUP_CONTENTS] as BackupContentId[],
})
const mpBackupAction = ref('')
const mpBackupBusy = computed(() => Boolean(mpBackupAction.value))
const mpBackupStatus = ref('')
const mpBackupStatusOk = ref(false)
const mpBackupProgress = ref<BackupProgress | null>(null)
let backupJobListener: ((message: unknown) => void) | null = null
const backupAuto = reactive({
  enabled: false,
  intervalHours: 24,
  onChange: false,
})
const backupIntervalPresets = MP_BACKUP_INTERVAL_HOUR_PRESETS
const backupSettingsBusy = computed(() => webdavBusy.value || mpBackupBusy.value)

function formatProgressBytes(bytes?: number): string {
  const value = bytes || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`
}

function progressBytesLabel(progress: BackupProgress): string {
  if (!progress.totalBytes) return ''
  if (progress.transferredBytes == null) return formatProgressBytes(progress.totalBytes)
  return `${formatProgressBytes(progress.transferredBytes)} / ${formatProgressBytes(progress.totalBytes)}`
}

function progressChunkLabel(progress: BackupProgress): string {
  if (!progress.chunkCount || !progress.chunkIndex) return ''
  return `分片 ${progress.chunkIndex} / ${progress.chunkCount}`
}

function backupProgressStatus(progress: BackupProgress): '' | 'success' | 'exception' {
  if (progress.phase === 'completed') return 'success'
  if (progress.phase === 'failed') return 'exception'
  return ''
}

function applyBackupJobState(state: BackupJobState | null, showResult = false): void {
  if (!state) return
  const progress = { ...state.progress }
  if (state.target === 'mp') {
    mpBackupProgress.value = progress
    mpBackupAction.value = state.status === 'running' ? 'backup' : ''
    if (state.status === 'completed') {
      mpBackupStatusOk.value = true
      mpBackupStatus.value = state.completedAt
        ? `完成于 ${new Date(state.completedAt).toLocaleString('zh-CN', { hour12: false })}`
        : '备份文件已安全写入 MoviePilot'
    } else if (state.status === 'failed') {
      mpBackupStatusOk.value = false
      mpBackupStatus.value = state.error || '备份失败'
    }
  } else {
    webdavProgress.value = progress
    webdavAction.value = state.status === 'running' ? 'backup' : ''
  }
  if (showResult && state.status !== 'running' && !state.acknowledgedAt) {
    if (state.status === 'completed') ElMessage.success(`${state.target === 'mp' ? 'MoviePilot' : 'WebDAV'} 备份已完成`)
    else ElMessage.error(`${state.target === 'mp' ? 'MoviePilot' : 'WebDAV'} 备份失败：${state.error || '未知错误'}`)
    void sendMessage(MSG.BACKUP_ACKNOWLEDGE, { id: state.id })
  }
}

async function restoreBackupJobState(): Promise<void> {
  try {
    const state = await sendMessage<BackupJobState | null>(MSG.BACKUP_GET_STATE)
    applyBackupJobState(state, true)
  } catch {
    // 后台尚未就绪时保持当前页面状态
  }
}

function listenBackupJobUpdates(): void {
  if (backupJobListener) return
  backupJobListener = (message: unknown) => {
    const data = message as { type?: string; payload?: BackupJobState }
    if (data?.type !== MSG.BACKUP_JOB_UPDATED || !data.payload) return
    applyBackupJobState(data.payload, true)
  }
  chrome.runtime.onMessage.addListener(backupJobListener)
}

async function startBackgroundBackup(target: BackupJobTarget): Promise<void> {
  const state = await sendMessage<BackupJobState>(MSG.BACKUP_START, { target })
  applyBackupJobState(state)
}

function failedProgress(current: BackupProgress | null, error: unknown): BackupProgress {
  return {
    phase: 'failed',
    label: `备份失败：${String(error)}`,
    percent: current?.percent || 0,
    transferredBytes: current?.transferredBytes,
    totalBytes: current?.totalBytes,
    chunkIndex: current?.chunkIndex,
    chunkCount: current?.chunkCount,
    currentFile: current?.currentFile,
  }
}
type BackupKeyAction = 'generate' | 'export' | 'import' | 'regenerate'

const backupKeyRaw = ref('')
const backupKeyId = computed(() => backupKeyRaw.value.split('.')[1] || '')
const backupKeyConfigured = computed(() => Boolean(backupKeyRaw.value))
const backupKeySaving = ref(false)
const backupKeyPinDialog = ref(false)
const backupKeyPin = ref('')
const backupKeyPinInputRef = ref<{ focus?: () => void } | null>(null)
const pendingBackupKeyAction = ref<BackupKeyAction | null>(null)
let pendingBackupKeyFile: PickedPageFile | null = null
let syncingBackupAuto = false
let mpBackupSkipAutoSave = false
let mpBackupSaveTimer: ReturnType<typeof setTimeout> | null = null

/** 还原备份列表弹窗 */
interface RestoreItem extends BackupSnapshotSummary {
  label: string
  sub?: string
}
const restoreDialog = ref(false)
const restoreSource = ref<'webdav' | 'mp'>('webdav')
const restoreItems = ref<RestoreItem[]>([])
const restoreSelected = ref('')
const restoreContents = ref<BackupContentId[]>([])
const restoreMode = ref<RestoreMode>('replace')

const selectedRestoreItem = computed(
  () => restoreItems.value.find((item) => item.id === restoreSelected.value) || null,
)
const restoreLoading = ref(false)
const restoreApplying = ref(false)
const activeRestoreProgress = computed(() => (
  restoreSource.value === 'mp' ? mpBackupProgress.value : webdavProgress.value
))



function backupFileLabel(pathOrName: string): string {
  const parts = pathOrName.split('/').filter(Boolean)
  const parent = parts.at(-2) || ''
  const compact = parent.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\d{3}Z$/)
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`
  }
  return parts.at(-1) || pathOrName
}

function onRestoreDialogClosed(): void {
  restoreItems.value = []
  restoreSelected.value = ''
  restoreContents.value = []
  restoreMode.value = 'replace'
  restoreLoading.value = false
  restoreApplying.value = false
}

async function openRestorePicker(source: 'webdav' | 'mp'): Promise<void> {
  restoreSource.value = source
  restoreDialog.value = true
  restoreLoading.value = true
  restoreItems.value = []
  restoreSelected.value = ''
  try {
    if (source === 'webdav') {
      await flushWebDavBeforeAction()
      const list = await listBackups()
      restoreItems.value = list.map((item) => ({
        ...item,
        label: backupFileLabel(item.manifestName),
        sub: item.manifestName,
      }))
    } else {
      await flushMpBackupBeforeAction()
      const list = await listMpBackups()
      restoreItems.value = list.map((item) => ({
        ...item,
        label: backupFileLabel(item.manifestName),
        sub: item.manifestName,
      }))
    }
    if (restoreItems.value.length) {
      restoreSelected.value = restoreItems.value[0].id
      restoreContents.value = [...restoreItems.value[0].contents]
    }
  } catch (e) {
    restoreDialog.value = false
    ElMessage.error(`加载备份列表失败：${String(e)}`)
  } finally {
    restoreLoading.value = false
  }
}

watch(restoreSelected, () => {
  restoreContents.value = selectedRestoreItem.value ? [...selectedRestoreItem.value.contents] : []
})

function requestLocalDataAction(action: 'cache' | 'all'): void {
  if (!pinSet.value || localDataAction.value) return
  pendingLocalDataAction.value = action
  dangerPinDialog.value = true
}

function onDangerPinDialogOpened(): void {
  nextTick(() => {
    requestAnimationFrame(() => dangerPinInputRef.value?.focus?.())
  })
}

function onDangerPinDialogClosed(): void {
  dangerPin.value = ''
  pendingLocalDataAction.value = null
}

async function onConfirmDangerPin(): Promise<void> {
  if (dangerPin.value.length < 6) {
    ElMessage.warning('请输入 6 位 PIN')
    dangerPinInputRef.value?.focus?.()
    return
  }
  if (!(await verifyPin(dangerPin.value))) {
    dangerPin.value = ''
    ElMessage.error('PIN 不正确')
    dangerPinInputRef.value?.focus?.()
    return
  }
  const action = pendingLocalDataAction.value
  dangerPinDialog.value = false
  if (action === 'cache') await onClearCacheAssets()
  else if (action === 'all') await onClearAllLocalData()
}

async function onClearCacheAssets(): Promise<void> {
  try {
    await confirmAction('将清除缓存、自定义背景、高清图标包和离线 OCR 资产，确认继续？', {
      title: '清空缓存/资产', kind: 'warning', confirmButtonText: '清空',
    })
  } catch { return }
  localDataAction.value = 'cache'
  try {
    await Promise.all([clearCache(), clearAssetRepository(), clearIconPack(), clearOcrRuntime()])
    await Promise.all([refreshIconPackMeta(), refreshOcrModels(), resetOcrSession()])
    ElMessage.success('缓存与资产已清空')
  } catch (error) {
    ElMessage.error(`清空失败：${String(error)}`)
  } finally { localDataAction.value = '' }
}

async function onClearAllLocalData(): Promise<void> {
  try {
    await confirmAction('此操作会删除全部账号、凭据、TOTP、恢复密钥、设置和本地资产，且不可撤销。', {
      title: '清空全部本地数据', kind: 'warning', confirmButtonText: '永久清空',
    })
  } catch { return }
  localDataAction.value = 'all'
  try {
    await Promise.all([clearAllStores(), clearAssetRepository(), clearIconPack(), clearOcrRuntime()])
    ElMessage.success('全部本地数据已清空，请重新打开扩展')
  } catch (error) {
    ElMessage.error(`清空失败：${String(error)}`)
  } finally { localDataAction.value = '' }
}

async function onConfirmRestoreSelected(): Promise<void> {

  const item = selectedRestoreItem.value
  if (!item || !restoreContents.value.length) return
  try {
    await confirmAction(
      restoreMode.value === 'replace'
        ? '还原将替换所选本地领域与资源包，确认继续？'
        : '还原将按稳定主键合并账号、凭据、TOTP 与 OCR 纠错；资源包仍会替换，确认继续？', {

      title: restoreSource.value === 'mp' ? '还原 MoviePilot 备份' : '还原 WebDAV 备份',
      kind: 'warning',
      confirmButtonText: '还原',
    })
  } catch {
    return
  }

  restoreApplying.value = true
  const targetProgress = restoreSource.value === 'mp' ? mpBackupProgress : webdavProgress
  targetProgress.value = null
  try {
    if (restoreSource.value === 'webdav') {
      await restoreBackup(item, restoreContents.value, restoreMode.value, (progress) => {
        webdavProgress.value = { ...progress }
      })
      ElMessage.success(`已还原：${backupFileLabel(item.manifestName)}`)
    } else {
      await restoreFromMp(item, restoreContents.value, restoreMode.value, (progress) => {
        mpBackupProgress.value = { ...progress }
      })
      ElMessage.success(`已从 MoviePilot 还原：${backupFileLabel(item.manifestName)}`)
    }
    await Promise.all([refreshIconPackMeta(), refreshOcrModels(), resetOcrSession()])
    restoreDialog.value = false
    window.setTimeout(() => {
      if (targetProgress.value?.phase === 'completed') targetProgress.value = null
    }, 2200)
  } catch (e) {
    targetProgress.value = failedProgress(targetProgress.value, e)
    ElMessage.error(`还原失败：${String(e)}`)
  } finally {
    restoreApplying.value = false
  }
}

const cookieUa = ref<CookieUaConfig>({
  dailyFirstEnabled: false,
  intervalEnabled: false,
  intervalMinutes: 360,
})
const cookieUaSaving = ref(false)
const cookieUaSyncing = ref(false)
const cookieUaIntervalPresets = COOKIE_UA_INTERVAL_PRESETS
const autoOpen = ref<SiteAutoOpenConfig>({
  monthlyFirstEnabled: false,
  intervalEnabled: false,
  intervalDays: 7,
  autoCloseEnabled: false,
  keepLoginTabsEnabled: true,
  closeDelayMinutes: 5,
})
const autoOpenSaving = ref(false)
const autoOpenRunning = ref(false)
const siteOpenIntervalPresets = SITE_AUTO_OPEN_INTERVAL_PRESETS
const siteCloseDelayPresets = SITE_AUTO_CLOSE_DELAY_PRESETS
/**
 * 配置从 storage 异步加载；未就绪前不渲染开关，
 * 避免默认 false 先渲染再跳到 true 的“关→开”闪动。
 */
const settingsReady = ref(false)
/** 首屏加载中禁止开关 @change / watch 自动保存写回 */
let settingsHydrating = false

async function refresh(): Promise<void> {
  const firstLoad = !settingsReady.value
  settingsHydrating = true
  try {
    pinSet.value = await hasPin()
    frequency.value = await pinFrequency()
    // themeMode / isDark 绑定 themeState，无需再手动同步
    const cfg = await loadCustomBgConfig()
    Object.assign(bgConfig, cfg)
    dailyWallpaperEnabled.value = await isDailyWallpaperEnabled()
    await refreshIconPackMeta()
    await refreshOcrModels()
    await refreshCorrections()
    await loadWebEmbedConfig()
    await loadApiToken()
    await loadBackupKeyValue()
    webdavSkipAutoSave = true
    mpBackupSkipAutoSave = true
    try {
      webdav.value = await loadWebDavConfig()
      mpBackup.value = await loadMpBackupConfig()
      syncingBackupAuto = true
      backupAuto.enabled = mpBackup.value.autoEnabled || webdav.value.autoEnabled
      backupAuto.onChange = mpBackup.value.autoOnChange || webdav.value.autoOnChange
      backupAuto.intervalHours = mpBackup.value.autoEnabled
        ? mpBackup.value.intervalHours
        : webdav.value.intervalHours
      const autoConfigDiverged =
        mpBackup.value.autoEnabled !== backupAuto.enabled ||
        webdav.value.autoEnabled !== backupAuto.enabled ||
        mpBackup.value.autoOnChange !== backupAuto.onChange ||
        webdav.value.autoOnChange !== backupAuto.onChange ||
        mpBackup.value.intervalHours !== backupAuto.intervalHours ||
        webdav.value.intervalHours !== backupAuto.intervalHours
      applyUnifiedBackupAuto()
      if (autoConfigDiverged) {
        await Promise.all([
          saveWebDavConfig({ ...webdav.value }),
          saveMpBackupConfig({ ...mpBackup.value }),
        ])
      }
    } finally {
      syncingBackupAuto = false
      await nextTick()
      webdavSkipAutoSave = false
      mpBackupSkipAutoSave = false
    }
    cookieUa.value = await loadCookieUaConfig()
    autoOpen.value = await loadSiteAutoOpenConfig()
    if (firstLoad) {
      await nextTick()
      settingsReady.value = true
    }
  } finally {
    await nextTick()
    settingsHydrating = false
  }
}

async function loadWebEmbedConfig(): Promise<void> {
  const config = await getWebEmbedFeaturesConfig()
  Object.assign(webEmbed, config)
}

async function saveWebEmbedConfigForm(): Promise<void> {
  if (settingsHydrating || !settingsReady.value) return
  webEmbedSaving.value = true
  try {
    await saveWebEmbedFeaturesConfig({ ...webEmbed })
    ElMessage.success('WEB 嵌入功能设置已保存')
  } catch (e) {
    await loadWebEmbedConfig()
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    webEmbedSaving.value = false
  }
}

function desensitizeToken(value: string): string {
  if (value.length <= 6) return '******'
  return `${value.slice(0, 3)}****${value.slice(-3)}`
}

async function loadApiToken(): Promise<void> {
  const raw = ((await storageGet<string>(STORAGE_KEYS.AI_TOKEN)) || '').trim()
  apiTokenRaw.value = raw
  apiTokenPlaceholder.value = raw ? desensitizeToken(raw) : 'moviepilot'
  // 默认不展示明文，聚焦后再填入
  apiTokenInput.value = ''
}

function onApiTokenFocus(): void {
  if (!apiTokenInput.value) apiTokenInput.value = apiTokenRaw.value
}

function onApiTokenBlur(): void {
  if (apiTokenInput.value === apiTokenRaw.value) apiTokenInput.value = ''
}

async function saveApiToken(): Promise<void> {
  const trimmed = apiTokenInput.value.trim()
  try {
    if (!trimmed) {
      await storageRemove(STORAGE_KEYS.AI_TOKEN)
      apiTokenRaw.value = ''
      apiTokenPlaceholder.value = 'moviepilot'
      apiTokenInput.value = ''
      ElMessage.info('将使用默认 API Token: moviepilot')
      return
    }
    await storageSet(STORAGE_KEYS.AI_TOKEN, trimmed)
    apiTokenRaw.value = trimmed
    apiTokenPlaceholder.value = desensitizeToken(trimmed)
    apiTokenInput.value = ''
    ElMessage.success('API Token 已保存')
  } catch (e) {
    ElMessage.error(`保存失败：${String(e)}`)
  }
}

function onThemeChange(val: 'light' | 'dark' | 'auto'): void {
  void applyTheme(val)
}

function onPinSwitchChange(val: string | number | boolean): void {
  if (val) dialog.value = true
  else disablePinDialog.value = true
}

async function onFrequencyChange(): Promise<void> {
  await setPinFrequency(frequency.value)
  ElMessage.success('已更新验证频率')
}

function focusConfirm(): void {
  confirmInputRef.value?.focus?.()
}

function onPinDialogOpened(): void {
  nextTick(() => {
    requestAnimationFrame(() => pinInputRef.value?.focus?.())
  })
}

function onDisablePinDialogOpened(): void {
  nextTick(() => {
    requestAnimationFrame(() => currentPinInputRef.value?.focus?.())
  })
}

function onPinDialogClosed(): void {
  pin.value = ''
  confirmPin.value = ''
}

function onDisablePinDialogClosed(): void {
  currentPin.value = ''
}

function cancelPinDialog(): void {
  dialog.value = false
  // 若是首次开启开关后取消，关闭 PIN 状态
  if (!pinSet.value) {
    // switch already false when cancelled from enable flow via onPinSwitchChange only opens dialog
  }
}

async function onSetPin(): Promise<void> {
  if (pin.value.length < 6) {
    ElMessage.warning('请输入 6 位 PIN')
    pinInputRef.value?.focus?.()
    return
  }
  if (confirmPin.value.length < 6) {
    ElMessage.warning('请再次输入确认 PIN')
    confirmInputRef.value?.focus?.()
    return
  }
  if (pin.value !== confirmPin.value) {
    ElMessage.error('两次输入的 PIN 不一致')
    confirmPin.value = ''
    confirmInputRef.value?.focus?.()
    return
  }
  saving.value = true
  try {
    const wasSet = pinSet.value
    await setPin(pin.value, frequency.value)
    dialog.value = false
    pin.value = ''
    confirmPin.value = ''
    await refresh()
    ElMessage.success(wasSet ? 'PIN 已更新' : '已启用 PIN 安全保护')
  } finally {
    saving.value = false
  }
}

async function onClosePin(): Promise<void> {
  if (saving.value) return
  if (currentPin.value.length < 6) {
    ElMessage.warning('请输入当前 6 位 PIN')
    currentPinInputRef.value?.focus?.()
    return
  }

  saving.value = true
  try {
    const verified = await unlock(currentPin.value)
    if (!verified) {
      ElMessage.error('PIN 验证失败')
      currentPin.value = ''
      currentPinInputRef.value?.focus?.()
      return
    }
    await disablePin()
    pinSet.value = false
    disablePinDialog.value = false
    currentPin.value = ''
    ElMessage.success('已关闭 PIN 安全保护')
  } catch (e) {
    ElMessage.error(`关闭失败：${String(e)}`)
  } finally {
    saving.value = false
  }
}

async function refreshOcrModels(): Promise<void> {
  try {
    ocrModels.value = await listOcrModels()
    const active = await getActiveOcrModel()
    ocrActiveId.value = active?.id ?? null
  } catch {
    ocrModels.value = []
    ocrActiveId.value = null
  }
  try {
    const st = await getOcrRuntimeStatus()
    ocrRuntimeReady.value = st.ready
    ocrRuntimeMeta.value = st.meta
  } catch {
    ocrRuntimeReady.value = false
    ocrRuntimeMeta.value = null
  }
}

async function resetOcrSession(): Promise<void> {
  try {
    await sendMessage(MSG.OCR_RESET_SESSION)
  } catch {
    /* offscreen 未创建时忽略 */
  }
}

async function onImportOcrPack(): Promise<void> {
  const files = await requestFilesFromActivePage({
    action: 'settings:ocr-pack',
    view: 'settings',
    accept: '.zip',
    title: '选择离线 OCR 包',
  })
  if (files[0]) await importOcrPackFile(files[0])
}

async function importOcrPackFile(item: PickedPageFile): Promise<void> {
  const zip = new File([item.bytes], item.name, { type: item.type })
  ocrModelAction.value = 'import'
  try {
    const { runtime, modelName } = await importOcrOfflinePack(zip, ocrImportProfile.value)
    await resetOcrSession()
    await refreshOcrModels()
    ElMessage.success(
      `离线包已导入：WASM ${formatRuntimeSize(runtime.totalSize)}，模型 ${modelName || '已启用'}`,
    )
  } catch (e) {
    ElMessage.error(`导入失败：${String(e)}`)
  } finally {
    ocrModelAction.value = ''
  }
}

async function onClearOcrRuntime(): Promise<void> {
  try {
    await confirmAction('确定清除已导入的 OCR WASM？离线识别将不可用。', {
      title: '清除 WASM',
      kind: 'danger',
      confirmButtonText: '清除',
    })
  } catch {
    return
  }
  ocrModelAction.value = 'clear-runtime'
  try {
    await clearOcrRuntime()
    await resetOcrSession()
    await refreshOcrModels()
    ElMessage.success('已清除 WASM')
  } catch (e) {
    ElMessage.error(`清除失败：${String(e)}`)
  } finally {
    ocrModelAction.value = ''
  }
}

async function onActivateOcrModel(id: string): Promise<void> {
  ocrModelAction.value = `activate:${id}`
  try {
    await setActiveOcrModel(id)
    await resetOcrSession()
    await refreshOcrModels()
    ElMessage.success('已切换模型')
  } catch (e) {
    ElMessage.error(`切换失败：${String(e)}`)
  } finally {
    ocrModelAction.value = ''
  }
}

async function onRemoveOcrModel(id: string): Promise<void> {
  try {
    await confirmAction('确定删除该 OCR 模型？', {
      title: '删除模型',
      kind: 'danger',
      confirmButtonText: '删除',
    })
  } catch {
    return
  }
  ocrModelAction.value = `remove:${id}`
  try {
    await removeOcrModel(id)
    await resetOcrSession()
    await refreshOcrModels()
    ElMessage.success('已删除模型')
  } catch (e) {
    ElMessage.error(`删除失败：${String(e)}`)
  } finally {
    ocrModelAction.value = ''
  }
}

async function refreshCorrections(): Promise<void> {
  try {
    correctionEntries.value = await listCorrections()
  } catch {
    correctionEntries.value = []
  }
}

async function openCorrectionManager(): Promise<void> {
  await refreshCorrections()
  correctionDraftWrong.value = ''
  correctionDraftRight.value = ''
  correctionDialog.value = true
}

async function onAddCorrection(): Promise<void> {
  const wrong = correctionDraftWrong.value.trim()
  const right = correctionDraftRight.value.trim()
  if (!wrong || !right) {
    ElMessage.warning('请填写识别错误与正确结果')
    return
  }
  correctionBusy.value = true
  try {
    const status = await upsertCorrection(wrong, right)
    correctionDraftWrong.value = ''
    correctionDraftRight.value = ''
    await refreshCorrections()
    if (status === 'added') ElMessage.success(`已添加：${wrong} → ${right}`)
    else if (status === 'updated') ElMessage.success(`已更新：${wrong} → ${right}`)
    else ElMessage.info('无变化项已忽略')
  } catch (e) {
    ElMessage.error(`保存失败：${String(e)}`)
  } finally {
    correctionBusy.value = false
  }
}

async function onRemoveCorrection(wrong: string): Promise<void> {
  try {
    await confirmAction(`确定删除映射「${wrong}」？`, {
      title: '删除纠错',
      kind: 'danger',
      confirmButtonText: '删除',
    })
  } catch {
    return
  }
  correctionBusy.value = true
  try {
    await removeCorrection(wrong)
    await refreshCorrections()
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(`删除失败：${String(e)}`)
  } finally {
    correctionBusy.value = false
  }
}

async function onExportCorrections(): Promise<void> {
  const text = await exportCorrections()
  downloadText('ocr-corrections.json', text)
  ElMessage.success('已导出纠错词表')
}

async function onImportCorrections(): Promise<void> {
  const files = await requestFilesFromActivePage({
    action: 'settings:corrections',
    view: 'settings',
    accept: 'application/json,.json',
    title: '选择 OCR 纠错词表',
  })
  if (files[0]) await importCorrectionsFile(files[0])
}

async function importCorrectionsFile(item: PickedPageFile): Promise<void> {
  try {
    const n = await importCorrections(new TextDecoder().decode(item.bytes))
    await refreshCorrections()
    ElMessage.success(`已导入 ${n} 条纠错`)
  } catch (e) {
    ElMessage.error(`导入失败：${String(e)}`)
  }
}

async function refreshIconPackMeta(): Promise<void> {
  try {
    iconPackMeta.value = await getIconPackMeta()
  } catch {
    iconPackMeta.value = null
  }
}

async function onImportIconPack(): Promise<void> {
  const files = await requestFilesFromActivePage({
    action: 'settings:icon-pack',
    view: 'settings',
    accept: '.zip',
    title: '选择高清图标包',
  })
  if (files[0]) await importIconPackFile(files[0])
}

async function importIconPackFile(item: PickedPageFile): Promise<void> {
  iconPackAction.value = 'import'
  try {
    const result = await importIconPackFromZip(item.bytes)
    iconPackMeta.value = result.meta
    ElMessage.success(`已导入 ${result.meta.count} 个站点图标`)
  } catch (e) {
    ElMessage.error(`导入失败：${String(e)}`)
  } finally {
    iconPackAction.value = ''
  }
}

async function onClearIconPack(): Promise<void> {
  try {
    await confirmAction('确定清除已导入的站点高清图标包？清除后将回退到站点/API 图标或首字母占位。', {
      title: '清除图标包',
      kind: 'warning',
      confirmButtonText: '清除',
    })
  } catch {
    return
  }
  iconPackAction.value = 'clear'
  try {
    await clearIconPack()
    iconPackMeta.value = null
    ElMessage.success('已清除图标包')
  } catch (e) {
    ElMessage.error(`清除失败：${String(e)}`)
  } finally {
    iconPackAction.value = ''
  }
}

// 自定义背景

async function saveBgConfig(): Promise<void> {
  bgSaving.value = true
  try {
    await saveCustomBgConfig({ ...bgConfig })
  } catch {
    ElMessage.error('保存背景配置失败')
  } finally {
    bgSaving.value = false
  }
}

async function onBgEnabledChange(val: string | number | boolean): Promise<void> {
  bgConfig.enabled = Boolean(val)
  await saveBgConfig()
}

async function onPickBackground(): Promise<void> {
  const files = await requestFilesFromActivePage({
    action: 'settings:background',
    view: 'settings',
    accept: 'image/*',
    title: '选择自定义背景图片',
  })
  if (files[0]) await importBackgroundFile(files[0])
}

async function importBackgroundFile(item: PickedPageFile): Promise<void> {
  const file = new File([item.bytes], item.name, { type: item.type })
  bgSaving.value = true
  try {
    const base64 = await compressAndResizeImage(file)
    await applyImageAsBackground(base64, '', true)
    bgConfig.enabled = true
    ElMessage.success('背景图片上传成功')
  } catch (e) {
    ElMessage.error(`图片处理失败: ${String(e)}`)
  } finally {
    bgSaving.value = false
  }
}

async function onClearBackground(): Promise<void> {
  bgSaving.value = true
  try {
    await clearCustomBgImage()
    ElMessage.success('已清除背景图片')
  } catch {
    ElMessage.error('清除背景图片失败')
  } finally {
    bgSaving.value = false
  }
}

async function onTestBgUrl(): Promise<void> {
  const url = bgConfig.url.trim()
  if (!url) {
    ElMessage.warning('请输入图片 URL')
    return
  }
  testingUrl.value = true
  try {
    const base64 = await downloadAndCompressImage(url)
    await applyImageAsBackground(base64, url, true)
    bgConfig.enabled = true
    ElMessage.success('背景图片获取并更新成功')
  } catch (e) {
    ElMessage.error(`获取背景图片失败: ${String(e)}`)
  } finally {
    testingUrl.value = false
  }
}

async function onFetchMpWallpapers(): Promise<void> {
  fetchingWallpapers.value = true
  try {
    mpWallpapers.value = await fetchMpWallpapers()
    if (!mpWallpapers.value.length) {
      ElMessage.info('未获取到壁纸，请检查 MP 服务器配置')
    }
  } catch {
    ElMessage.error('获取壁纸失败，请检查 MP 服务器连接')
  } finally {
    fetchingWallpapers.value = false
  }
}

async function onSelectMpWallpaper(url: string): Promise<void> {
  bgConfig.url = url
  bgSaving.value = true
  try {
    const base64 = await downloadAndCompressImage(url)
    await applyImageAsBackground(base64, url, true)
    bgConfig.enabled = true
    ElMessage.success('壁纸设置成功')
  } catch (e) {
    ElMessage.error(`壁纸设置失败: ${String(e)}`)
  } finally {
    bgSaving.value = false
  }
}

async function onDailyWallpaperToggle(val: string | number | boolean): Promise<void> {
  const enabled = Boolean(val)
  await setDailyWallpaperEnabled(enabled)
  if (enabled) {
    fetchingDaily.value = true
    try {
      const ok = await fetchDailyWallpaper(false)
      if (ok) {
        const cfg = await loadCustomBgConfig()
        Object.assign(bgConfig, cfg)
        ElMessage.success('每日壁纸设置成功')
      }
    } catch (e) {
      ElMessage.error(String(e))
    } finally {
      fetchingDaily.value = false
    }
  } else {
    ElMessage.info('已关闭每日壁纸')
  }
}

async function saveCookieUa(): Promise<void> {
  if (settingsHydrating || !settingsReady.value) return
  cookieUaSaving.value = true
  try {
    await saveCookieUaConfig(cookieUa.value)
    ElMessage.success('自动更新设置已保存')
  } catch (e) {
    cookieUa.value = await loadCookieUaConfig()
    ElMessage.error(`保存失败：${String(e)}`)
  } finally {
    cookieUaSaving.value = false
  }
}

async function onSyncNow(): Promise<void> {
  cookieUaSyncing.value = true
  try {
    const n = await syncCookieUa('manual')
    ElMessage.success(`已同步 ${n} 个站点`)
  } catch (e) {
    ElMessage.error(`同步失败：${String(e)}`)
  } finally {
    cookieUaSyncing.value = false
  }
}

async function saveAutoOpen(): Promise<void> {
  if (settingsHydrating || !settingsReady.value) return
  autoOpenSaving.value = true
  try {
    await saveSiteAutoOpenConfig(autoOpen.value)
    ElMessage.success('自动打开设置已保存')
  } catch (e) {
    autoOpen.value = await loadSiteAutoOpenConfig()
    ElMessage.error(`保存失败：${String(e)}`)
  } finally {
    autoOpenSaving.value = false
  }
}

async function onOpenNow(): Promise<void> {
  autoOpenRunning.value = true
  try {
    const n = await openAllSites('manual')
    ElMessage.success(`已打开 ${n} 个站点`)
  } catch (e) {
    ElMessage.error(`打开失败：${String(e)}`)
  } finally {
    autoOpenRunning.value = false
  }
}

async function loadBackupKeyValue(): Promise<void> {
  backupKeyRaw.value = await loadBackupKey()
}

function requestBackupKeyAction(action: BackupKeyAction, file?: PickedPageFile): void {
  if (!pinSet.value) {
    ElMessage.warning('请先启用 PIN 安全保护')
    return
  }
  pendingBackupKeyAction.value = action
  pendingBackupKeyFile = file || null
  backupKeyPinDialog.value = true
}

function onBackupKeyPinDialogOpened(): void {
  nextTick(() => requestAnimationFrame(() => backupKeyPinInputRef.value?.focus?.()))
}

function onBackupKeyPinDialogClosed(): void {
  backupKeyPin.value = ''
  pendingBackupKeyAction.value = null
  pendingBackupKeyFile = null
}

async function exportBackupKeyFile(recoveryKey: string): Promise<void> {
  const keyId = recoveryKey.split('.')[1] || ''
  const content = await createRecoveryKeyFile(recoveryKey)
  downloadText(
    recoveryKeyFileName(keyId),
    content,
    'application/vnd.moviepilot-tools.recovery-key+json',
  )
}

async function generateAndExportBackupKey(replace: boolean): Promise<void> {
  if (replace) {
    try {
      await confirmAction('重新生成不会转换历史备份。旧备份仍需要原 .mpkey 文件，请确认旧文件已妥善保存。', {
        title: '重新生成恢复密钥',
        kind: 'danger',
        confirmButtonText: '继续生成',
      })
    } catch {
      return
    }
  }

  const value = await generateBackupKey()
  await exportBackupKeyFile(value)
  await saveBackupKey(value)
  backupKeyRaw.value = value
  ElMessage.success('恢复密钥已生成并导出，请将 .mpkey 文件离线妥善保存')
}

async function importBackupKeyFile(item: PickedPageFile): Promise<void> {
  if (!item.name.toLowerCase().endsWith('.mpkey')) throw new Error('请选择 .mpkey 恢复密钥文件')
  if (item.bytes.byteLength > RECOVERY_KEY_FILE_MAX_BYTES) throw new Error('恢复密钥文件过大')
  const content = new TextDecoder().decode(item.bytes)
  const parsed = await parseRecoveryKeyFile(content)

  if (backupKeyRaw.value && parsed.recoveryKey !== backupKeyRaw.value) {
    try {
      await confirmAction('导入不同恢复密钥后，新备份将使用新密钥；历史备份仍需要原 .mpkey 文件。', {
        title: '替换恢复密钥',
        kind: 'danger',
        confirmButtonText: '确认导入',
      })
    } catch {
      return
    }
  }

  await saveBackupKey(parsed.recoveryKey)
  backupKeyRaw.value = parsed.recoveryKey
  ElMessage.success('恢复密钥已安全导入，请继续妥善保存原 .mpkey 文件')
}

async function onConfirmBackupKeyPin(): Promise<void> {
  if (backupKeyPin.value.length < 6) {
    ElMessage.warning('请输入 6 位 PIN')
    backupKeyPinInputRef.value?.focus?.()
    return
  }
  if (!(await verifyPin(backupKeyPin.value))) {
    backupKeyPin.value = ''
    ElMessage.error('PIN 不正确')
    backupKeyPinInputRef.value?.focus?.()
    return
  }

  const action = pendingBackupKeyAction.value
  const file = pendingBackupKeyFile
  backupKeyPinDialog.value = false
  backupKeySaving.value = true
  try {
    if (action === 'generate') await generateAndExportBackupKey(false)
    else if (action === 'regenerate') await generateAndExportBackupKey(true)
    else if (action === 'export' && backupKeyRaw.value) {
      await exportBackupKeyFile(backupKeyRaw.value)
      ElMessage.success('恢复密钥文件已导出，请作为敏感资产离线妥善保存')
    } else if (action === 'import') {
      if (file) await importBackupKeyFile(file)
      else await onSelectBackupKeyFile()
    }
  } catch (error) {
    ElMessage.error(`恢复密钥操作失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    backupKeySaving.value = false
  }
}

async function onSelectBackupKeyFile(): Promise<void> {
  const files = await requestFilesFromActivePage({
    action: 'settings:recovery-key',
    view: 'settings',
    accept: RECOVERY_KEY_FILE_ACCEPT,
    title: '选择恢复密钥文件',
  })
  if (files[0]) requestBackupKeyAction('import', files[0])
}

function requireBackupKeyForEnable(enabled: boolean, source: 'mp' | 'webdav'): boolean {
  if (!enabled || backupKeyRaw.value) return true
  if (source === 'mp') mpBackup.value.enabled = false
  else webdav.value.enabled = false
  ElMessage.warning('请先生成恢复密钥、导出保存，再启用远端备份')
  return false
}

function onMpBackupEnabledChange(enabled: boolean): void {
  requireBackupKeyForEnable(enabled, 'mp')
}

function onWebDavEnabledChange(enabled: boolean): void {
  requireBackupKeyForEnable(enabled, 'webdav')
}

function applyUnifiedBackupAuto(): void {

  mpBackup.value.autoEnabled = backupAuto.enabled
  mpBackup.value.intervalHours = backupAuto.intervalHours
  mpBackup.value.autoOnChange = backupAuto.onChange
  webdav.value.autoEnabled = backupAuto.enabled
  webdav.value.intervalHours = backupAuto.intervalHours
  webdav.value.autoOnChange = backupAuto.onChange
}

function clearWebDavSaveTimer(): void {
  if (webdavSaveTimer) {
    clearTimeout(webdavSaveTimer)
    webdavSaveTimer = null
  }
}

function clearMpBackupSaveTimer(): void {
  if (mpBackupSaveTimer) {
    clearTimeout(mpBackupSaveTimer)
    mpBackupSaveTimer = null
  }
}

/** 静默自动保存（输入过程中不强制校验完整表单） */
async function autoSaveWebDav(): Promise<void> {
  try {
    applyUnifiedBackupAuto()
    await saveWebDavConfig({ ...webdav.value })
  } catch (e) {
    console.warn('[WebDav] auto-save failed:', e)
  }
}

async function autoSaveMpBackup(): Promise<void> {
  try {
    applyUnifiedBackupAuto()
    await saveMpBackupConfig({ ...mpBackup.value })
  } catch (e) {
    console.warn('[MpBackup] auto-save failed:', e)
  }
}

function scheduleWebDavAutoSave(): void {
  if (settingsHydrating || !settingsReady.value || webdavSkipAutoSave || webdavBusy.value) return
  clearWebDavSaveTimer()
  webdavSaveTimer = setTimeout(() => {
    void autoSaveWebDav()
  }, 500)
}

function scheduleMpBackupAutoSave(): void {
  if (settingsHydrating || !settingsReady.value || mpBackupSkipAutoSave || mpBackupBusy.value) return
  clearMpBackupSaveTimer()
  mpBackupSaveTimer = setTimeout(() => {
    void autoSaveMpBackup()
  }, 500)
}

async function onTestWebDav(): Promise<void> {
  webdavAction.value = 'test'
  try {
    await flushWebDavBeforeAction()
    await testWebDavConnection({ ...webdav.value })
    ElMessage.success('WebDAV 连接成功')
  } catch (e) {
    ElMessage.error(`WebDAV 连接失败：${String(e)}`)
  } finally {
    webdavAction.value = ''
  }
}

async function flushWebDavBeforeAction(): Promise<void> {
  clearWebDavSaveTimer()
  await autoSaveWebDav()
}

async function onBackupNow(): Promise<void> {
  webdavAction.value = 'backup'
  webdavProgress.value = null
  try {
    await flushWebDavBeforeAction()
    await startBackgroundBackup('webdav')
  } catch (e) {
    webdavProgress.value = failedProgress(webdavProgress.value, e)
    webdavAction.value = ''
    ElMessage.error(`备份启动失败：${String(e)}`)
  }
}

async function onRestore(): Promise<void> {
  webdavAction.value = 'restore'
  try {
    await openRestorePicker('webdav')
  } finally {
    webdavAction.value = ''
  }
}

async function flushMpBackupBeforeAction(): Promise<void> {
  clearMpBackupSaveTimer()
  await autoSaveMpBackup()
}

async function onCheckMpBackup(): Promise<void> {
  mpBackupAction.value = 'check'
  try {
    await flushMpBackupBeforeAction()
    const ready = await checkMpBackupReady()
    mpBackupStatusOk.value = ready.ok
    mpBackupStatus.value = ready.message
    if (ready.ok) ElMessage.success(ready.message)
    else ElMessage.warning(ready.message)
  } catch (e) {
    mpBackupStatusOk.value = false
    mpBackupStatus.value = String(e)
    ElMessage.error(`检测失败：${String(e)}`)
  } finally {
    mpBackupAction.value = ''
  }
}

async function onBackupMpNow(): Promise<void> {
  mpBackupAction.value = 'backup'
  mpBackupProgress.value = null
  try {
    await flushMpBackupBeforeAction()
    await startBackgroundBackup('mp')
  } catch (e) {
    mpBackupProgress.value = failedProgress(mpBackupProgress.value, e)
    mpBackupAction.value = ''
    mpBackupStatusOk.value = false
    mpBackupStatus.value = String(e)
    ElMessage.error(`备份启动失败：${String(e)}`)
  }
}

async function onRestoreMp(): Promise<void> {
  mpBackupAction.value = 'restore'
  try {
    await openRestorePicker('mp')
  } finally {
    mpBackupAction.value = ''
  }
}

watch(
  backupAuto,
  () => {
    if (syncingBackupAuto) return
    syncingBackupAuto = true
    applyUnifiedBackupAuto()
    syncingBackupAuto = false
  },
  { deep: true },
)

watch(
  webdav,
  () => {
    scheduleWebDavAutoSave()
  },
  { deep: true },
)

watch(
  mpBackup,
  () => {
    scheduleMpBackupAutoSave()
  },
  { deep: true },
)

onMounted(async () => {
  listenBackupJobUpdates()
  await Promise.all([refresh(), restoreBackupJobState()])
  const [ocrPack, corrections, iconPack, background, recoveryKeyFiles] = await Promise.all([
    consumePickedPageFiles('settings:ocr-pack'),
    consumePickedPageFiles('settings:corrections'),
    consumePickedPageFiles('settings:icon-pack'),
    consumePickedPageFiles('settings:background'),
    consumePickedPageFiles('settings:recovery-key'),
  ])
  if (ocrPack[0]) await importOcrPackFile(ocrPack[0])
  if (corrections[0]) await importCorrectionsFile(corrections[0])
  if (iconPack[0]) await importIconPackFile(iconPack[0])
  if (background[0]) await importBackgroundFile(background[0])
  if (recoveryKeyFiles[0]) requestBackupKeyAction('import', recoveryKeyFiles[0])
})
onBeforeUnmount(() => {
  clearWebDavSaveTimer()
  clearMpBackupSaveTimer()
  // 离开页面前尽量落盘
  if (!webdavSkipAutoSave) void autoSaveWebDav()
  if (!mpBackupSkipAutoSave) void autoSaveMpBackup()
})
</script>

<style scoped>
.settings-root {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-loading {
  padding: 28px 12px;
  text-align: center;
}

.settings-loading-text {
  font-size: 13px;
  color: #64748b;
}


.backup-auto-controls {
  margin-top: 12px;
  padding: 2px 10px;
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.055);
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.1);
}

.backup-key-settings {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 10px;
  align-items: end;
  margin-top: 10px;
  padding: 12px 10px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.025);
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.backup-key-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.backup-key-required {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 5px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
}

.backup-key-copy,
.backup-key-id,
.backup-key-actions,
.backup-key-warning {
  min-width: 0;
  grid-column: 1 / -1;
}

.backup-key-status {
  display: inline-flex;
  width: max-content;
  align-items: center;
  align-self: start;
  justify-self: start;
  gap: 5px;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: #f1f5f9;
  box-shadow: inset 0 0 0 1px rgba(100, 116, 139, 0.12);
  color: #64748b;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 22px;
}

.backup-key-status::before {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: currentColor;
  content: '';
  opacity: 0.55;
}

.backup-key-status.is-ready {
  background: rgba(16, 185, 129, 0.1);
  box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.18);
  color: #047857;
}

.backup-key-status.is-ready::before {
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
  opacity: 1;
}

.backup-key-id {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.035);
  color: #64748b;
  font-size: 11px;
}

.backup-key-id strong {
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.backup-key-actions {
  flex-wrap: wrap;
  margin-top: 2px;
}

.backup-key-actions :deep(.el-button) {
  min-width: 72px;
}

.backup-key-warning {
  font-size: 11px;
  line-height: 16px;
  color: #b45309;
}

.backup-content-select {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--mp-color-border);
  border-radius: var(--mp-radius);
  background: var(--mp-color-surface);
}

.backup-content-title {
  color: #475569;
}

.backup-content-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 12px;
  width: 100%;
  margin-top: 9px;
}

.backup-content-options :deep(.el-checkbox) {
  width: auto;
  min-width: 0;
  height: 20px;
  margin-right: 0;
}

.backup-content-options :deep(.el-checkbox__label) {
  padding-left: 6px;
  white-space: nowrap;
  font-size: 12px;
  line-height: 20px;
}

.backup-source {
  padding-top: 12px;
}

.backup-source-divider {
  margin-top: 14px;
  padding-top: 16px;
  border-top: 1px solid rgba(15, 23, 42, 0.1);
}

.backup-source-header {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 32px;
}

.backup-source-header .section-title-wrap {
  min-width: 0;
  flex: 1;
}

.backup-source-switch {
  flex: 0 0 auto;
  margin-left: auto;
}

.backup-source-icon {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid;
  border-radius: 9px;
}

.backup-source-icon svg {
  width: 17px;
  height: 17px;
  fill: currentColor;
}

.backup-source-title {
  font-size: 13px;
  font-weight: 700;
  line-height: 18px;
  color: #334155;
}

.backup-source-subtitle {
  font-size: 11px;
  line-height: 16px;
  color: #64748b;
}

.backup-progress {
  --backup-progress-accent: var(--mp-color-info);
  margin-top: 10px;
  padding: 10px 11px 9px;
  border-radius: 10px;
  color: var(--mp-color-text);
  background: color-mix(in srgb, var(--mp-color-surface) 92%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--mp-color-border) 82%, transparent),
    0 1px 2px rgba(15, 23, 42, 0.035);
}

.backup-progress--mp {
  --backup-progress-accent: var(--mp-color-success);
}

.backup-progress--webdav {
  --backup-progress-accent: var(--mp-color-info);
}

.backup-progress-head,
.backup-progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.backup-progress-head {
  margin-bottom: 8px;
}

.backup-progress-label {
  min-width: 0;
  overflow: hidden;
  color: var(--mp-color-text);
  font-size: 11.5px;
  font-weight: 600;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backup-progress-percent {
  flex: 0 0 auto;
  color: var(--backup-progress-accent);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.backup-progress :deep(.el-progress-bar__outer) {
  height: 5px !important;
  overflow: hidden;
  background: color-mix(in srgb, var(--mp-color-border-strong) 34%, transparent);
  box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.06);
}

.backup-progress :deep(.el-progress-bar__inner) {
  background: var(--backup-progress-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--backup-progress-accent) 18%, transparent);
  transition: width 0.28s var(--mp-ease);
}

.backup-progress-meta {
  min-height: 14px;
  margin-top: 7px;
  color: var(--mp-color-text-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.backup-progress.is-success {
  --backup-progress-accent: var(--mp-color-success);
}

.backup-progress.is-error {
  --backup-progress-accent: var(--mp-color-danger);
  background: color-mix(in srgb, var(--mp-color-danger) 5%, var(--mp-color-surface));
}

.backup-progress.is-error .backup-progress-label,
.backup-progress.is-error .backup-progress-percent {
  color: var(--mp-color-danger);
}

.backup-progress.is-indeterminate :deep(.el-progress-bar__inner) {
  width: 34% !important;
  animation: backup-progress-slide 1.2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

@keyframes backup-progress-slide {
  0% { transform: translateX(-105%); }
  55% { transform: translateX(85%); }
  100% { transform: translateX(205%); }
}

@media (prefers-reduced-motion: reduce) {
  .backup-progress.is-indeterminate :deep(.el-progress-bar__inner) {
    animation: none;
    transform: translateX(92%);
  }
}

.ocr-model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.ocr-model-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
}

.ocr-model-item.active {
  border-color: rgba(124, 58, 237, 0.35);
  background: linear-gradient(135deg, #f5f3ff 0%, #faf5ff 100%);
}

.ocr-model-main {
  min-width: 0;
  flex: 1;
}

.ocr-model-name {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ocr-model-badge {
  font-size: 10px;
  font-weight: 600;
  color: #7c3aed;
  background: #ede9fe;
  border-radius: 999px;
  padding: 1px 6px;
}

.ocr-model-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #94a3b8;
}

:global(html[data-theme='dark']) .ocr-model-item {
  background: #243447 !important;
  border-color: #3d4f66 !important;
}

:global(html[data-theme='dark']) .ocr-model-item.active {
  background: rgba(124, 58, 237, 0.16) !important;
  border-color: rgba(167, 139, 250, 0.42) !important;
}

:global(html[data-theme='dark']) .ocr-model-name {
  color: #f1f5f9 !important;
}

:global(html[data-theme='dark']) .ocr-model-badge {
  color: #c4b5fd !important;
  background: rgba(124, 58, 237, 0.22) !important;
}

:global(html[data-theme='dark']) .ocr-model-sub {
  color: #94a3b8 !important;
}

/* 模型行内按钮：覆盖 Element 默认浅色底 */
:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button--default),
:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button:not(.el-button--primary):not(.el-button--danger)) {
  background: #1e293b !important;
  border-color: #475569 !important;
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button--default:hover),
:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button:not(.el-button--primary):not(.el-button--danger):hover) {
  background: #334155 !important;
  border-color: #64748b !important;
  color: #f8fafc !important;
}

:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button--default.is-disabled),
:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button.is-disabled:not(.el-button--primary):not(.el-button--danger)) {
  background: #1e293b !important;
  border-color: #334155 !important;
  color: #64748b !important;
  opacity: 1 !important;
}

:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button--danger.is-plain),
:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button--danger) {
  color: #fca5a5 !important;
  background: rgba(239, 68, 68, 0.12) !important;
  border-color: rgba(248, 113, 113, 0.35) !important;
}

:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button--danger.is-plain:hover),
:global(html[data-theme='dark']) .ocr-model-item .setting-btns :deep(.el-button--danger:hover) {
  color: #fecaca !important;
  background: rgba(239, 68, 68, 0.2) !important;
  border-color: rgba(248, 113, 113, 0.5) !important;
}


.retain-count-row {
  align-items: center;
}

.retain-count-input {
  width: 120px !important;
  flex-shrink: 0;
}

.settings-root :deep(.retain-count-input.el-input-number) {
  width: 120px;
}
.settings-card {
  border-radius: 14px;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 45%);
  border: 1px solid rgba(59, 130, 246, 0.12);
  box-shadow: 0 6px 18px rgba(59, 130, 246, 0.08);
}

.settings-card :deep(.el-card__body) {
  padding: 12px;
}

.local-data-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.danger-operation-tag {
  display: inline-flex;
  align-items: center;
  min-height: 19px;
  padding: 2px 7px;
  border-radius: 999px;
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.09);
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.2);
  font-size: 10px;
  font-weight: 650;
  line-height: 15px;
}

.local-data-pin-hint {
  margin-top: 9px;
  padding: 7px 9px;
  border-radius: 8px;
  color: #b45309;
  background: rgba(245, 158, 11, 0.08);
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.18);
  font-size: 10.5px;
  line-height: 1.45;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.section-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eff6ff;
  color: #2563eb;
  border: 1px solid #bfdbfe;
  flex-shrink: 0;
}

.section-icon svg {
  width: 19px;
  height: 19px;
  fill: currentColor;
}

.theme-icon {
  background: #eff6ff;
  color: #2563eb;
  border-color: #bfdbfe;
}

.cookie-icon {
  background: #ecfdf5;
  color: #059669;
  border-color: #bbf7d0;
}

.open-icon {
  background: #fff7ed;
  color: #ea580c;
  border-color: #fed7aa;
}

.ocr-icon,
.backup-icon,
.mp-backup-icon,
.webdav-icon {
  background: #f5f3ff;
  color: #7c3aed;
  border-color: #ddd6fe;
}

.embed-icon {
  background: #ecfeff;
  color: #0284c7;
  border-color: #a5f3fc;
}



.section-title-wrap {
  min-width: 0;
}

.section-title {
  font-size: 14px;
  font-weight: 700;
  color: #334155;
  line-height: 20px;
}

.section-subtitle {
  font-size: 11px;
  color: #64748b;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
}

.setting-main {
  min-width: 0;
}

.setting-title {
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.setting-desc {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.45;
  color: #64748b;
}

.setting-btns {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}



/* 覆盖 Element Plus 默认相邻按钮 margin，避免与 gap 叠加过大 */
.setting-btns :deep(.el-button + .el-button) {
  margin-left: 0;
}

/* 统一设置页按钮 / 输入框（使用二级弹窗控件尺寸） */
.settings-root :deep(.el-button--small) {
  height: 30px;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
}

.settings-root :deep(.el-button--small.is-plain) {
  font-weight: 500;
}

/*
 * Element Plus :loading 会在文案前插入图标，且 `.el-icon + span` 会给 span
 * 加 margin-left（约 6px），按钮仍会轻微变宽。图标绝对居中脱离文档流，
 * 文案透明保留占位并强制 margin-left:0，宽度完全不变。
 * 用 inset+margin 居中，避免 transform 覆盖旋转动画。
 */
.settings-root :deep(.el-button.is-loading) {
  position: relative;
  pointer-events: none;
}

.settings-root :deep(.el-button.is-loading > .el-icon.is-loading) {
  position: absolute;
  inset: 0;
  margin: auto !important;
  width: 1em;
  height: 1em;
  z-index: 1;
}

.settings-root :deep(.el-button.is-loading > span) {
  opacity: 0;
  margin-left: 0 !important;
}

/* 弹窗 teleport 到 body，需 global 覆盖同样规则 */
:global(.pin-dialog .el-button.is-loading) {
  position: relative;
  pointer-events: none;
}

:global(.pin-dialog .el-button.is-loading > .el-icon.is-loading) {
  position: absolute;
  inset: 0;
  margin: auto !important;
  width: 1em;
  height: 1em;
  z-index: 1;
}

:global(.pin-dialog .el-button.is-loading > span) {
  opacity: 0;
  margin-left: 0 !important;
}

.settings-root :deep(.el-input--small .el-input__wrapper),
.settings-root :deep(.el-input .el-input__wrapper) {
  min-height: 30px;
  border-radius: 8px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
}

.settings-root :deep(.el-input .el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #1677ff inset !important;
}

.settings-root :deep(.el-input-number--small),
.settings-root :deep(.el-input-number) {
  width: 100%;
}

.settings-root :deep(.el-input-number .el-input__wrapper) {
  min-height: 30px;
  border-radius: 8px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
}

.settings-root :deep(.el-input-number .el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #1677ff inset !important;
}

/*
 * 右侧加减：
 * - 固定在输入框内 1px 边距，不遮挡 focus 边框
 * - 上下各半高贴合，中间仅 1px 分隔
 */
.settings-root :deep(.el-input-number.is-controls-right) {
  height: 30px;
  line-height: 28px;
  --el-input-number-controls-height: 14px;
}

.settings-root :deep(.el-input-number.is-controls-right .el-input__wrapper) {
  padding-left: 12px;
  padding-right: 30px;
}

.settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase),
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease) {
  box-sizing: border-box;
  width: 24px;
  height: 14px !important;
  line-height: 14px;
  margin: 0;
  left: auto;
  right: 1px;
  z-index: 2;
  background: #f1f5f9;
  border: none;
  border-left: 1px solid #e2e8f0;
  color: #475569;
  transition: background 0.15s ease, color 0.15s ease;
}

/* 上按钮：贴顶内侧 1px，不盖住边框 */
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase) {
  top: 1px;
  bottom: auto;
  border-radius: 0 7px 0 0;
  border-bottom: 1px solid #e2e8f0;
}

/* 下按钮：贴底内侧 1px */
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease) {
  top: auto;
  bottom: 1px;
  border-radius: 0 0 7px 0;
}

.settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase .el-icon),
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease .el-icon) {
  font-size: 11px;
  transform: scale(0.9);
}


.speed-tag {
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  vertical-align: middle;
}

.setting-main-stack {
  flex-direction: column;
  align-items: flex-start !important;
  gap: 6px;
  width: 100%;
}

.api-token-input {
  margin-top: 2px;
  max-width: 280px;
  width: 100%;
}
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase:hover:not(.is-disabled)),
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease:hover:not(.is-disabled)) {
  color: #1677ff;
  background: #dbeafe;
}

/* 禁用：保留可见对比；悬停不变亮 */
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase.is-disabled),
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease.is-disabled),
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase.is-disabled:hover),
.settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease.is-disabled:hover),
.settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__increase),
.settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__decrease),
.settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__increase:hover),
.settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__decrease:hover) {
  color: #94a3b8 !important;
  background: #e2e8f0 !important;
  cursor: not-allowed;
  opacity: 1 !important;
}

.settings-root :deep(.theme-radio-group .el-radio-button__inner) {
  height: 30px;
  line-height: 30px;
  padding: 0 12px;
  font-size: 12px;
  border: 0 !important;
  border-radius: 0;
  outline: 0 !important;
  box-shadow: none !important;
}

.settings-root :deep(.theme-radio-group .el-radio-button:first-child .el-radio-button__inner) {
  border-radius: 8px 0 0 8px;
}

.settings-root :deep(.theme-radio-group .el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 0 8px 8px 0;
}

.settings-root :deep(.theme-radio-group .el-radio-button.is-active .el-radio-button__inner) {
  box-shadow: none !important;
  z-index: 1;
}

.settings-root :deep(.theme-radio-group .el-radio-button__original-radio:focus-visible + .el-radio-button__inner) {
  filter: brightness(0.94);
}

.settings-root :deep(.el-form-item__label) {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 6px !important;
  line-height: 1.25;
  padding: 0;
  height: auto;
}

.settings-root :deep(.el-form-item) {
  margin-bottom: 12px;
}

.recommend-tag {
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: #059669;
  background: #ecfdf5;
  border: 1px solid #bbf7d0;
  vertical-align: middle;
}

.recommend-tag.backup-required-tag {
  color: #dc2626;
  background: #fef2f2;
  border-color: #fecaca;
}

.interval-row {
  margin-top: 4px;
}

.interval-select-row {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(15, 23, 42, 0.08);
}

.interval-input {
  width: 100%;
  margin-top: 8px;
}

.interval-select {
  width: 100%;
  margin-top: 8px;
}

.settings-root :deep(.interval-select .el-select__wrapper) {
  min-height: 30px;
  border-radius: 8px;
}

.url-row {
  display: flex;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
  align-items: center;
}

.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  color: #334155;
  margin-bottom: 4px;
}

.mp-wallpaper-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
  width: 100%;
}

.mp-wallpaper-item {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.mp-wallpaper-item:hover {
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.mp-wallpaper-item.active {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
}

.mp-wallpaper-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.theme-radio-group {
  flex-shrink: 0;
}

.webdav-form {
  padding-top: 12px;
}

.row-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.half {
  min-width: 0;
}

.webdav-tip {
  margin: 10px 0 4px;
  border-radius: 10px;
  border: 1px solid rgba(59, 130, 246, 0.18);
  background: linear-gradient(135deg, #eff6ff 0%, #f8fbff 100%);
  padding: 10px 12px;
  align-items: flex-start;
}

.webdav-tip :deep(.el-alert__icon) {
  font-size: 15px;
  width: 15px;
  color: #2563eb;
  margin-top: 1px;
}

.backup-result {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  margin: 10px 0 4px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--mp-color-surface);
  box-shadow: inset 0 0 0 1px var(--mp-color-border);
}

.backup-result.is-success {
  background: rgba(34, 197, 94, 0.06);
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.22);
}

.backup-result.is-error {
  background: rgba(239, 68, 68, 0.05);
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.2);
}

.backup-result-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.backup-result-icon svg {
  width: 17px;
  height: 17px;
  fill: currentColor;
}

.backup-result.is-success .backup-result-icon {
  color: #16a34a;
  background: rgba(34, 197, 94, 0.1);
}

.backup-result.is-error .backup-result-icon {
  color: #dc2626;
  background: rgba(239, 68, 68, 0.1);
}

.backup-result-copy {
  min-width: 0;
}

.backup-result-title {
  font-size: 12px;
  font-weight: 650;
  line-height: 1.3;
  color: var(--mp-color-text);
}

.backup-result-desc {
  margin-top: 2px;
  overflow: hidden;
  font-size: 10.5px;
  line-height: 1.4;
  color: var(--mp-color-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.webdav-actions {
  flex-wrap: wrap;
}

.webdav-actions :deep(.el-button) {
  min-width: 72px;
}

.webdav-tip :deep(.el-alert__content) {
  padding: 0;
}

.webdav-tip :deep(.el-alert__title),
.webdav-tip :deep(.el-alert__description) {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: #334155;
  font-weight: 500;
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.settings-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.frequency-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(15, 23, 42, 0.08);
}

.frequency-options {
  width: 100%;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.frequency-option {
  width: 100%;
  height: auto;
  margin-right: 0;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 10px;
  background: #fff;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;
}

.frequency-option:hover {
  border-color: rgba(37, 99, 235, 0.28);
  background: #f8fbff;
}

.frequency-option.is-checked {
  border-color: rgba(37, 99, 235, 0.5);
  background: #eff6ff;
}

.frequency-option :deep(.el-radio__label) {
  flex: 1;
  min-width: 0;
  white-space: normal;
}

.frequency-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.frequency-title {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
}

.frequency-desc {
  font-size: 11px;
  line-height: 1.35;
  color: #64748b;
}

:global(html[data-theme='dark']) .backup-auto-controls {
  background: rgba(59, 130, 246, 0.1);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.15);
}

:global(html[data-theme='dark']) .backup-key-settings,
:global(html[data-theme='dark']) .backup-content-select {
  background: rgba(15, 23, 42, 0.38);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.14);
}

:global(html[data-theme='dark']) .backup-key-status {
  background: rgba(100, 116, 139, 0.16);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.16);
  color: #94a3b8;
}

:global(html[data-theme='dark']) .backup-key-status.is-ready {
  background: rgba(16, 185, 129, 0.14);
  box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.22);
  color: #6ee7b7;
}

:global(html[data-theme='dark']) .backup-key-warning {
  color: #fbbf24;
}

:global(html[data-theme='dark']) .backup-source-divider {
  border-top-color: #334155;
}

:global(html[data-theme='dark']) .backup-source-title {
  color: #e2e8f0;
}

:global(html[data-theme='dark']) .backup-source-subtitle {
  color: #94a3b8;
}

:global(html[data-theme='dark']) .backup-progress {
  background: color-mix(in srgb, var(--mp-color-surface-2) 72%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--mp-color-border-strong) 72%, transparent),
    0 1px 2px rgba(0, 0, 0, 0.18);
}

:global(html[data-theme='dark']) .backup-progress :deep(.el-progress-bar__outer) {
  background: color-mix(in srgb, var(--mp-color-border-strong) 56%, transparent);
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.26);
}

:global(html[data-theme='dark']) .backup-progress-meta {
  color: var(--mp-color-text-secondary);
}

.danger-text {
  color: var(--el-color-danger);
}

/* 深色主题：!important 覆盖浅色硬编码 + EP 默认 */
:global(html[data-theme='dark']) .settings-card {
  background: #1e293b !important;
  border-color: #334155 !important;
  color: #e2e8f0 !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
}

:global(html[data-theme='dark']) .danger-operation-tag {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.14);
  box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.28);
}

:global(html[data-theme='dark']) .local-data-pin-hint {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.12);
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.22);
}

:global(html[data-theme='dark']) .section-header {
  border-bottom-color: #334155 !important;
}

:global(html[data-theme='dark']) .section-title,
:global(html[data-theme='dark']) .setting-title,
:global(html[data-theme='dark']) .slider-label,
:global(html[data-theme='dark']) .frequency-title {
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .section-subtitle,
:global(html[data-theme='dark']) .setting-desc,
:global(html[data-theme='dark']) .frequency-desc {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .frequency-option.is-checked .frequency-title {
  color: #60a5fa !important;
}

:global(html[data-theme='dark']) .embed-icon {
  background: rgba(14, 165, 233, 0.15) !important;
  color: #38bdf8 !important;
  border-color: rgba(14, 165, 233, 0.3) !important;
}

:global(html[data-theme='dark']) .speed-tag {
  color: #fbbf24 !important;
  background: rgba(245, 158, 11, 0.12) !important;
  border-color: rgba(245, 158, 11, 0.3) !important;
}

:global(html[data-theme='dark']) .section-icon,
:global(html[data-theme='dark']) .theme-icon {
  background: rgba(59, 130, 246, 0.15) !important;
  color: #60a5fa !important;
  border-color: rgba(59, 130, 246, 0.3) !important;
}

:global(html[data-theme='dark']) .cookie-icon {
  background: rgba(16, 185, 129, 0.15) !important;
  color: #34d399 !important;
  border-color: rgba(16, 185, 129, 0.3) !important;
}

:global(html[data-theme='dark']) .open-icon {
  background: rgba(249, 115, 22, 0.15) !important;
  color: #fb923c !important;
  border-color: rgba(249, 115, 22, 0.3) !important;
}

:global(html[data-theme='dark']) .ocr-icon,
:global(html[data-theme='dark']) .backup-icon,
:global(html[data-theme='dark']) .mp-backup-icon,
:global(html[data-theme='dark']) .webdav-icon {
  background: rgba(124, 58, 237, 0.15) !important;
  color: #a78bfa !important;
  border-color: rgba(124, 58, 237, 0.3) !important;
}



:global(html[data-theme='dark']) .section-icon svg,
:global(html[data-theme='dark']) .section-icon svg path {
  color: inherit !important;
  fill: currentColor !important;
}

:global(html[data-theme='dark']) .interval-select-row,
:global(html[data-theme='dark']) .frequency-block {
  border-top-color: #334155 !important;
}

:global(html[data-theme='dark']) .frequency-option {
  background: #0f172a !important;
  border-color: #334155 !important;
}

:global(html[data-theme='dark']) .frequency-option:hover {
  border-color: #475569 !important;
  background: rgba(255, 255, 255, 0.04) !important;
}

:global(html[data-theme='dark']) .frequency-option.is-checked {
  border-color: rgba(59, 130, 246, 0.45) !important;
  background: rgba(59, 130, 246, 0.15) !important;
}

:global(html[data-theme='dark']) .recommend-tag {
  color: #34d399 !important;
  background: rgba(16, 185, 129, 0.12) !important;
  border-color: rgba(16, 185, 129, 0.3) !important;
}

:global(html[data-theme='dark']) .backup-required-tag {
  color: #f87171 !important;
  background: rgba(220, 38, 38, 0.14) !important;
  border-color: rgba(248, 113, 113, 0.3) !important;
}

/* 输入 / 数字 / 选择 */
:global(html[data-theme='dark']) .settings-root :deep(.el-input__wrapper),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number .el-input__wrapper),
:global(html[data-theme='dark']) .settings-root :deep(.el-select__wrapper) {
  background: #0f172a !important;
  box-shadow: 0 0 0 1px #334155 inset !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-input__wrapper.is-focus),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number .el-input__wrapper.is-focus),
:global(html[data-theme='dark']) .settings-root :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px #3b82f6 inset !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-input__inner),
:global(html[data-theme='dark']) .settings-root :deep(.el-select__selected-item),
:global(html[data-theme='dark']) .settings-root :deep(.el-select__placeholder) {
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-input__inner::placeholder) {
  color: #64748b !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease) {
  background: #1e293b !important;
  border-left-color: #475569 !important;
  color: #cbd5e1 !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase) {
  border-bottom-color: #475569 !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase:hover:not(.is-disabled)),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease:hover:not(.is-disabled)) {
  color: #93c5fd !important;
  background: rgba(59, 130, 246, 0.2) !important;
}

/* 禁用/达边界：悬停不发白、不高亮，图标同色 */
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase.is-disabled),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease.is-disabled),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase.is-disabled:hover),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease.is-disabled:hover),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__increase),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__decrease),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__increase:hover),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__decrease:hover) {
  color: #475569 !important;
  background: #0f172a !important;
  cursor: not-allowed !important;
  opacity: 1 !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase.is-disabled .el-icon),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease.is-disabled .el-icon),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__increase.is-disabled svg),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-controls-right .el-input-number__decrease.is-disabled svg),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__increase .el-icon),
:global(html[data-theme='dark']) .settings-root :deep(.el-input-number.is-disabled.is-controls-right .el-input-number__decrease .el-icon) {
  color: #475569 !important;
  fill: currentColor !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-form-item__label) {
  color: #94a3b8 !important;
}

/* 主题 radio / 默认按钮 */
:global(html[data-theme='dark']) .settings-root :deep(.theme-radio-group .el-radio-button__inner) {
  background: #0f172a !important;
  border: 0 !important;
  outline: 0 !important;
  color: #cbd5e1 !important;
  box-shadow: none !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.theme-radio-group .el-radio-button.is-active .el-radio-button__inner) {
  background: #2563eb !important;
  border: 0 !important;
  outline: 0 !important;
  color: #fff !important;
  box-shadow: none !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-button--default) {
  --el-button-bg-color: #1e293b;
  --el-button-border-color: #334155;
  --el-button-text-color: #cbd5e1;
  --el-button-hover-bg-color: #334155;
  --el-button-hover-border-color: #475569;
  --el-button-hover-text-color: #e2e8f0;
  background: #1e293b !important;
  border-color: #334155 !important;
  color: #cbd5e1 !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-button--primary) {
  --el-button-bg-color: #2563eb;
  --el-button-border-color: #2563eb;
  --el-button-text-color: #fff;
  background: #2563eb !important;
  border-color: #2563eb !important;
  color: #fff !important;
}

:global(html[data-theme='dark']) .settings-root :deep(.el-button.is-plain) {
  background: transparent !important;
  border-color: #475569 !important;
  color: #cbd5e1 !important;
}

:global(html[data-theme='dark']) .backup-result.is-success {
  background: rgba(22, 163, 74, 0.12);
  box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.22);
}

:global(html[data-theme='dark']) .backup-result.is-error {
  background: rgba(220, 38, 38, 0.12);
  box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.22);
}

:global(html[data-theme='dark']) .backup-result.is-success .backup-result-icon {
  color: #4ade80;
}

:global(html[data-theme='dark']) .backup-result.is-error .backup-result-icon {
  color: #f87171;
}

:global(html[data-theme='dark']) .webdav-tip {
  border-color: rgba(96, 165, 250, 0.28) !important;
  background: linear-gradient(135deg, rgba(30, 58, 138, 0.35) 0%, rgba(15, 23, 42, 0.9) 100%) !important;
}

:global(html[data-theme='dark']) .webdav-tip :deep(.el-alert__icon) {
  color: #60a5fa !important;
}

:global(html[data-theme='dark']) .webdav-tip :deep(.el-alert__title),
:global(html[data-theme='dark']) .webdav-tip :deep(.el-alert__description) {
  color: #cbd5e1 !important;
}

:global(html[data-theme='dark']) .mp-wallpaper-item {
  border-color: #334155 !important;
}

:global(html[data-theme='dark']) .mp-wallpaper-item:hover {
  border-color: rgba(96, 165, 250, 0.5) !important;
}

:global(html[data-theme='dark']) .mp-wallpaper-item.active {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35) !important;
}

/* PIN 设置弹窗 */
.pin-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pin-dialog-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}

.pin-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pin-field-label {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
}

.pin-freq-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.pin-freq-opt {
  width: 100%;
  height: auto;
  margin-right: 0 !important;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 10px;
  background: #fff;
  box-sizing: border-box;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;
}

.pin-freq-opt:hover {
  border-color: rgba(37, 99, 235, 0.28);
  background: #f8fbff;
}

.pin-freq-opt.is-checked {
  border-color: rgba(37, 99, 235, 0.5);
  background: #eff6ff;
}

.pin-freq-opt :deep(.el-radio__label) {
  flex: 1;
  min-width: 0;
  padding-left: 8px;
  white-space: normal;
}

.pin-freq-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.pin-freq-title {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  line-height: 1.3;
}

.pin-freq-desc {
  font-size: 11px;
  line-height: 1.35;
  color: #64748b;
}

.pin-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.pin-dialog-footer :deep(.el-button) {
  min-width: 72px;
  height: 30px;
  border-radius: 8px;
  font-size: 12px;
  padding: 0 14px;
}

.pin-dialog-footer :deep(.el-button + .el-button) {
  margin-left: 0;
}

.restore-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.restore-dialog-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}

.restore-empty {
  padding: 22px 12px;
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
  background: var(--mp-color-surface);
  border: 1px dashed var(--mp-color-border);
  border-radius: var(--mp-radius);
}

.restore-section-title {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.restore-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.restore-section-head > span {
  font-size: 11px;
  color: #94a3b8;
}

.restore-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 210px;
  overflow-y: auto;
  padding-right: 2px;
}

.restore-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--mp-color-border);
  border-radius: var(--mp-radius);
  background: var(--mp-color-surface);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.restore-item:hover {
  border-color: rgba(37, 99, 235, 0.35);
  background: rgba(37, 99, 235, 0.03);
}

.restore-item.active {
  border-color: rgba(37, 99, 235, 0.55);
  background: rgba(37, 99, 235, 0.06);
}

.restore-item-main {
  min-width: 0;
  flex: 1;
}

.restore-item-name {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--mp-color-text);
}

.restore-item-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #94a3b8;
}

.restore-item-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
  border: 1.5px solid #cbd5e1;
  border-radius: 50%;
  font-size: 11px;
  color: #fff;
  background: var(--mp-color-surface);
}

.restore-item-check.on {
  border-color: #2563eb;
  background: #2563eb;
}

.restore-config-section {
  padding: 10px 12px;
  border: 1px solid var(--mp-color-border);
  border-radius: var(--mp-radius);
  background: var(--mp-color-surface);
}

.restore-content-options {
  justify-content: flex-start;
  margin-top: 9px;
}

.restore-mode-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  width: 100%;
  margin-top: 9px;
}

.restore-mode-options :deep(.el-radio) {
  width: auto;
  height: 20px;
  margin-right: 0;
}

.restore-mode-options :deep(.el-radio__label) {
  padding-left: 6px;
  font-size: 12px;
  line-height: 20px;
}

.restore-progress {
  margin-top: 14px;
}

.restore-note {
  font-size: 11px;
  line-height: 1.5;
  color: #b45309;
}

:global(.restore-dialog.el-dialog) {
  max-width: 420px;
  border-radius: 12px;
}

:global(.restore-dialog .el-dialog__body) {
  padding-top: 8px;
}

:global(html[data-theme='dark']) .restore-dialog-desc,
:global(html[data-theme='dark']) .restore-section-head > span,
:global(html[data-theme='dark']) .restore-item-sub {
  color: #94a3b8;
}

:global(html[data-theme='dark']) .restore-section-title {
  color: #cbd5e1;
}

:global(html[data-theme='dark']) .restore-note {
  color: #f59e0b;
}
/* 纠错弹窗挂到 body，需要全局设置 small 控件样式 */
:global(.pin-dialog.el-dialog) {
  max-width: 340px;
  border-radius: 12px;
  overflow: hidden;
}

:global(.correction-dialog.el-dialog) {
  max-width: 420px;
}

:global(.pin-dialog .el-dialog__header) {
  margin-right: 0;
  padding: 14px 16px 10px;
}

:global(.pin-dialog .el-dialog__title) {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

:global(.pin-dialog .el-dialog__body) {
  padding: 4px 16px 8px;
}

:global(.pin-dialog .el-dialog__footer) {
  padding: 10px 16px 14px;
}

/* 控件尺寸：高度 30 / 圆角 8 / 字号 12 */
:global(.pin-dialog .el-button--small),
:global(.correction-dialog .el-button--small) {
  height: 30px;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
}

:global(.pin-dialog .el-button--small.is-plain),
:global(.correction-dialog .el-button--small.is-plain) {
  font-weight: 500;
}

:global(.pin-dialog .el-input--small .el-input__wrapper),
:global(.pin-dialog .el-input .el-input__wrapper),
:global(.correction-dialog .el-input--small .el-input__wrapper),
:global(.correction-dialog .el-input .el-input__wrapper) {
  min-height: 30px;
  height: 30px;
  border-radius: 8px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
}

:global(.pin-dialog .el-input .el-input__wrapper.is-focus),
:global(.correction-dialog .el-input .el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #1677ff inset !important;
}

:global(.pin-dialog .el-input__inner),
:global(.correction-dialog .el-input__inner) {
  height: 28px;
  line-height: 28px;
  font-size: 12px;
}

:global(.correction-dialog .setting-btns) {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

:global(.correction-dialog .setting-btns .el-button + .el-button) {
  margin-left: 0;
}

:global(.correction-dialog .correction-add-row) {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}

:global(.correction-dialog .correction-field) {
  flex: 1 1 0;
  min-width: 0;
}

:global(.correction-dialog .correction-add-btn) {
  flex: 0 0 auto;
  min-width: 64px;
}

:global(.correction-dialog .correction-arrow) {
  flex-shrink: 0;
  color: #64748b;
  font-weight: 600;
  font-size: 13px;
  line-height: 30px;
  user-select: none;
}

:global(.correction-dialog .correction-arrow-inline) {
  margin: 0 4px;
  color: #94a3b8;
  font-weight: 600;
}

:global(.correction-dialog .correction-list) {
  max-height: 240px;
  overflow-y: auto;
  padding-right: 2px;
}

:global(html[data-theme='dark'] .pin-dialog .el-input__wrapper),
:global(html[data-theme='dark'] .correction-dialog .el-input__wrapper) {
  background: #0f172a;
  box-shadow: 0 0 0 1px #334155 inset;
}

:global(html[data-theme='dark'] .pin-dialog .el-input__wrapper.is-focus),
:global(html[data-theme='dark'] .correction-dialog .el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #60a5fa inset !important;
}

:global(html[data-theme='dark'] .correction-dialog .correction-arrow) {
  color: #94a3b8;
}

:global(html[data-theme='dark'] .pin-dialog.el-dialog) {
  background: #1e293b;
  border: 1px solid #334155;
}

:global(html[data-theme='dark'] .pin-dialog .el-dialog__title) {
  color: #f1f5f9;
}

:global(html[data-theme='dark']) .pin-dialog-desc {
  color: #94a3b8;
}

:global(html[data-theme='dark']) .pin-field-label {
  color: #e2e8f0;
}

:global(html[data-theme='dark']) .pin-freq-opt {
  background: #0f172a;
  border-color: #334155;
}

:global(html[data-theme='dark']) .pin-freq-opt:hover {
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(59, 130, 246, 0.08);
}

:global(html[data-theme='dark']) .pin-freq-opt.is-checked {
  border-color: rgba(96, 165, 250, 0.55);
  background: rgba(59, 130, 246, 0.1);
}
</style>
