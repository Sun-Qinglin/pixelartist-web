import { Icon } from "./icon";
import { PixelSprite } from "./pixel-sprite";

const TOOLS = ["pen", "layers", "film", "wheel", "save"] as const;

export function EditorMock() {
  return (
    <div className="hero-visual">
      <div className="float-chip float-chip--tl">无限图层</div>
      <div className="float-chip float-chip--br">逐帧动画</div>

      <div className="editor-mock" aria-hidden="true">
        <div className="mock-topbar">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          <span className="mock-title">PixelArtist — 未命名 (64 × 64)</span>
          <span className="mock-zoom">100%</span>
        </div>

        <div className="mock-body">
          <div className="mock-tools">
            {TOOLS.map((t, i) => (
              <span key={t} className={`mock-tool${i === 0 ? " is-active" : ""}`}>
                <Icon name={t} size={14} />
              </span>
            ))}
          </div>

          <div className="mock-canvas">
            <div className="mock-canvas-inner">
              <PixelSprite />
            </div>
            <span className="mock-marquee" />
            <span className="mock-cursor" />
          </div>

          <div className="mock-side">
            <div className="mock-side-title">颜色</div>
            <div className="swatches">
              {["#f2913d", "#ffb877", "#22314b", "#5ee0a0", "#f2c14e", "#e9e4da"].map(
                (c, i) => (
                  <span
                    key={c}
                    className={`swatch${i === 0 ? " is-active" : ""}`}
                    style={{ background: c }}
                  />
                ),
              )}
            </div>
            <div className="mock-side-title">图层</div>
            <div className="layer-row is-active">
              <span className="layer-dot" />
              线稿
            </div>
            <div className="layer-row">
              <span className="layer-dot" />
              上色
            </div>
            <div className="layer-row">
              <span className="layer-dot" />
              背景
            </div>
          </div>
        </div>

        <div className="mock-status">
          <span>64 × 64</span>
          <span>帧 1 / 3</span>
          <span className="mock-status-ok">自动保存已开启</span>
        </div>
      </div>
    </div>
  );
}
