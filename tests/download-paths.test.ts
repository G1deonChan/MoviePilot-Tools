import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('../core/http', () => ({ api: { get } }))

import { fetchDirectories } from '../services/download'

describe('MoviePilot 下载路径', () => {
  beforeEach(() => {
    get.mockReset()
  })

  it('使用专用 paths 接口并保留 save_path', async () => {
    get.mockResolvedValue({
      ok: true,
      data: [
        {
          name: '默认下载',
          storage: 'local',
          download_path: '/downloads',
          save_path: 'local:/downloads',
        },
      ],
    })

    await expect(fetchDirectories()).resolves.toEqual([
      {
        name: '默认下载',
        storage: 'local',
        download_path: '/downloads',
        save_path: 'local:/downloads',
      },
    ])
    expect(get).toHaveBeenCalledWith('/api/v1/download/paths')
  })
})
