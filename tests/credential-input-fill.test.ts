import { afterEach, describe, expect, it, vi } from 'vitest'
import { setCredentialInputValue } from '../content/pt-creds'

class FakeInput {
  private current = ''
  events: string[] = []

  get value(): string {
    return this.current
  }

  set value(value: string) {
    this.current = value
  }

  dispatchEvent(event: Event): boolean {
    this.events.push(event.type)
    return true
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('React/Ant Design 凭据输入框填充', () => {
  it('通过原生 value setter 写值并派发 input/change 事件', () => {
    vi.stubGlobal('HTMLInputElement', FakeInput)
    const input = new FakeInput() as unknown as HTMLInputElement

    setCredentialInputValue(input, 'zq-example-user')

    expect(input.value).toBe('zq-example-user')
    expect((input as unknown as FakeInput).events).toEqual(['input', 'change'])
  })

  it('密码值同样能写入受控输入框', () => {
    vi.stubGlobal('HTMLInputElement', FakeInput)
    const input = new FakeInput() as unknown as HTMLInputElement

    setCredentialInputValue(input, 'secret-password')

    expect(input.value).toBe('secret-password')
    expect((input as unknown as FakeInput).events).toEqual(['input', 'change'])
  })
})
