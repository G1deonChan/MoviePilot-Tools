<template>
  <div class="pin-code-inputs" ref="rootRef">
    <input
      v-for="(_, idx) in 6"
      :key="idx"
      type="password"
      inputmode="numeric"
      maxlength="1"
      class="pin-code-box"
      :value="digits[idx] || ''"
      :aria-label="`PIN 第 ${idx + 1} 位`"
      @input="onDigitInput(idx, $event)"
      @keydown="onDigitKeydown(idx, $event)"
      @paste="onPaste"
      @focus="onFocus"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'complete', v: string): void
  (e: 'enter'): void
}>()

const rootRef = ref<HTMLElement | null>(null)

const digits = computed(() => {
  const raw = (props.modelValue || '').replace(/\D/g, '').slice(0, 6)
  return raw.padEnd(6, '').split('')
})

function setValue(value: string): void {
  const next = value.replace(/\D/g, '').slice(0, 6)
  emit('update:modelValue', next)
  if (next.length === 6) emit('complete', next)
}

function getInputs(): HTMLInputElement[] {
  if (!rootRef.value) return []
  return Array.from(rootRef.value.querySelectorAll('input'))
}

function focusAt(idx: number): void {
  nextTick(() => {
    const inputs = getInputs()
    const el = inputs[Math.max(0, Math.min(5, idx))]
    el?.focus()
    el?.select()
  })
}

function onFocus(e: FocusEvent): void {
  ;(e.target as HTMLInputElement).select()
}

function onDigitInput(idx: number, e: Event): void {
  const input = e.target as HTMLInputElement
  const digit = input.value.replace(/\D/g, '').slice(-1)
  input.value = digit

  const chars = digits.value.slice()
  chars[idx] = digit
  const next = chars.join('').replace(/\s/g, '')
  setValue(next)

  if (digit && idx < 5) focusAt(idx + 1)
}

function onDigitKeydown(idx: number, e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    emit('enter')
    return
  }
  if (e.key === 'Backspace') {
    const current = props.modelValue || ''
    if (!current[idx] && idx > 0) {
      const chars = current.split('')
      chars[idx - 1] = ''
      setValue(chars.join(''))
      focusAt(idx - 1)
      e.preventDefault()
    }
  } else if (e.key === 'ArrowLeft' && idx > 0) {
    focusAt(idx - 1)
    e.preventDefault()
  } else if (e.key === 'ArrowRight' && idx < 5) {
    focusAt(idx + 1)
    e.preventDefault()
  }
}

function onPaste(e: ClipboardEvent): void {
  e.preventDefault()
  const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6)
  if (!pasted) return
  setValue(pasted)
  focusAt(Math.min(pasted.length, 5))
}

watch(
  () => props.modelValue,
  (v) => {
    // 外部清空值时同步重置输入框。
    if (!v) {
      nextTick(() => {
        getInputs().forEach((el) => {
          el.value = ''
        })
      })
    }
  },
)

defineExpose({
  focus: () => focusAt(0),
})
</script>

<style scoped>
.pin-code-inputs {
  display: flex;
  gap: 6px;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
  padding: 4px 0;
}

.pin-code-box {
  width: 38px;
  height: 38px;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0;
  color: #0f172a;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  outline: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  caret-color: #3b82f6;
}

.pin-code-box:focus {
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow:
    0 0 0 3px rgba(59, 130, 246, 0.15),
    0 1px 3px rgba(59, 130, 246, 0.1);
}

.pin-code-box:valid {
  border-color: #60a5fa;
  background: linear-gradient(180deg, #ffffff 0%, #eff6ff 100%);
  box-shadow:
    0 1px 2px rgba(59, 130, 246, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

:global(html[data-theme='dark']) .pin-code-box {
  color: #e2e8f0 !important;
  border-color: #334155 !important;
  background: #0f172a !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) !important;
  caret-color: #60a5fa !important;
}

:global(html[data-theme='dark']) .pin-code-box:focus {
  border-color: #3b82f6 !important;
  background: #0f172a !important;
  box-shadow:
    0 0 0 3px rgba(59, 130, 246, 0.25),
    0 1px 3px rgba(0, 0, 0, 0.3) !important;
}

:global(html[data-theme='dark']) .pin-code-box:valid {
  border-color: #60a5fa !important;
  background: #1e293b !important;
  box-shadow: none !important;
}
</style>
