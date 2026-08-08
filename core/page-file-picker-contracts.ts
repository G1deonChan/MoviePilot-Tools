export interface PageFilePickerOptions {
  action: string
  view: string
  accept: string
  multiple?: boolean
  title?: string
}

export const PAGE_FILE_PICK_REQUEST = 'MP_PAGE_FILE_PICK_REQUEST' as const
export const PAGE_FILE_PICKER_OPEN = 'MP_PAGE_FILE_PICKER_OPEN' as const
export const PAGE_FILE_PICKER_CANCEL = 'MP_PAGE_FILE_PICKER_CANCEL' as const
export const PAGE_FILE_PICK_PORT_PREFIX = 'MP_FILE_PICK_PAGE:' as const

export interface PageFilePickRequestMessage {
  type: typeof PAGE_FILE_PICK_REQUEST
  requestId: string
  options: PageFilePickerOptions
}

export interface PageFilePickerOpenMessage {
  type: typeof PAGE_FILE_PICKER_OPEN
  requestId: string
  options?: Partial<PageFilePickerOptions>
}

export interface PageFilePickerCancelMessage {
  type: typeof PAGE_FILE_PICKER_CANCEL
  requestId: string
}

export type PageFilePickerPortMessage =
  | { kind: 'task'; action: string; view: string }
  | { kind: 'meta'; index: number; name: string; type: string; size: number }
  | { kind: 'chunk'; index: number; chunk: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export function pageFilePickerPortName(requestId: string): string {
  return `${PAGE_FILE_PICK_PORT_PREFIX}${requestId}`
}
