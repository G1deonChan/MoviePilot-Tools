import { MSG, sendMessage } from '../core/bus'
import type { SiteSupportingInfo } from '../core/types'

export function fetchSupportingFromBackground(): Promise<Record<string, SiteSupportingInfo>> {
  return sendMessage<Record<string, SiteSupportingInfo>>(MSG.SITE_SUPPORTING_GET)
}
