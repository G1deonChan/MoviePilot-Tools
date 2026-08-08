// 原生 Shape Detection API（BarcodeDetector）类型声明：Chrome 扩展内置，但 @types/chrome 未覆盖
interface DetectedBarcode {
  boundingBox: DOMRectReadOnly
  rawValue: string
  format: string
  cornerPoints: { x: number; y: number }[]
}

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] })
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector
}
