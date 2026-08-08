# OCR 资源说明

本目录在 `pack-assets/ocr`，**不在** `public/`，扩展构建不会拷贝进来。

## 构建产物（扩展内）

构建时从 `node_modules/onnxruntime-web/dist` **仅复制胶水**到产物 `ocr/`：

- `ort.min.js`
- `ort-*.mjs`（及可选 worker）

**不复制** `.wasm` / 本目录模型，以控制扩展体积。

## 外置离线包（用户导入）

```bash
npm run pack:ocr
```

输出 `release/mp-ocr-offline-*.zip`，包含：

- `ort-wasm-simd-threaded*.wasm`
- `common.onnx`
- `charsets.json`

模型默认取自 `pack-assets/ocr/ddddocr-Mieru-OCR`，可用环境变量 `OCR_MODEL_DIR` 覆盖。

在扩展 **设置 → 离线 OCR → 导入 ZIP** 写入 IndexedDB。  
仅支持完整 zip 导入；离线识别需要：WASM + 模型均已就绪。
