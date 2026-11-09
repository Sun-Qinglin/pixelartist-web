/** 发行信息:打包出安装包后,把 downloadReady 改成 true 并更新文件信息即可。 */

export const release = {
  version: "0.1.0",
  date: "2026-11-09",
  channel: "公开测试",
  platform: "Windows 10 / 11 · 64 位",
  size: "64.18 MB",
  sha256: "8e5ace672f897ab2dc9045490f73df837ebab0328f53272be14e5e944a8e6fb1",
  /** false 时下载按钮显示"准备中";安装包放到 public/downloads/ 后改成 true */
  downloadReady: true,
  downloadPath: "/downloads/PixelArtist-0.1.0.exe",
  requirements: [
    "Windows 10 / 11 64 位",
    "支持 Vulkan 或 DirectX 12 的显卡",
    "约 200 MB 可用磁盘空间",
    "无需注册，下载即用",
  ],
  changelog: [
    "首个公开版本：绘图工具、图层、逐帧动画、自动保存",
    "Pro 能力：精灵表 / 批量帧 / GIF 动画导出（激活码解锁）",
    "HMAC-SHA256 激活码系统（永久 / 年付 / 月付 / 学生四档）",
    "暗色 / 明亮主题切换，终端风格本地身份校验",
    "自动保存恢复弹窗与退出前补存",
  ],
} as const;
