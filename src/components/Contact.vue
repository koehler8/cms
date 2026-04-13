<template>
  <section id="contact" class="contact-section ui-section ui-section--stacked" data-analytics-section="contact">
    <div class="container">
      <header class="section-header text-center">
        <div class="section-heading">
          <h2 class="display-heading">{{ title }}</h2>
          <span class="section-divider" aria-hidden="true"></span>
        </div>
        <p class="section-description">{{ subtitle }}</p>
      </header>
      <div class="contact-wrapper">
        <form id="signup" class="contact-form ui-card ui-card-surface" :action="formAction" method="POST">
          <!-- Google Forms requires these hidden fields -->
          <input type="hidden" name="entry.1210125274" id="siteToken">
          <input type="hidden" name="fvv" :value="hiddenFields.fvv">
          <!-- Replace the fbzx value with the real one from your form's HTML source or prefilled link -->
          <input type="hidden" name="fbzx" :value="hiddenFields.fbzx">
          <input type="hidden" name="pageHistory" :value="hiddenFields.pageHistory">
          <!-- Simple honeypot to deter bots -->
          <input type="text" name="website" tabindex="-1" autocomplete="off" style="display:none">

          <div class="contact-grid">
            <div class="contact-field">
              <input class="ui-form-control" type="text" :placeholder="placeholders.name" name="entry.757423084" required>
            </div>
            <div class="contact-field">
              <input class="ui-form-control" type="email" :placeholder="placeholders.email" name="entry.886201522" required>
            </div>
            <div class="contact-field">
              <input class="ui-form-control" type="text" :placeholder="placeholders.subject" name="entry.270717970">
            </div>
            <div class="contact-field">
              <input class="ui-form-control" type="tel" :placeholder="placeholders.phone" name="entry.1570175907">
            </div>
            <div class="contact-field contact-field--full">
              <textarea class="ui-form-control ui-form-textarea" rows="6" :placeholder="placeholders.message" name="entry.1743462629" required></textarea>
            </div>
            <div class="contact-field contact-field--full">
              <label class="contact-label ui-label-sm">{{ challenge.label }}</label>
              <small
                v-if="challenge.instructions"
                class="contact-hint ui-form-hint"
                :class="{ 'contact-hint--inline': challenge.label.length < 18 }"
              >
                {{ challenge.instructions }}
              </small>
              <div class="ui-input-group">
                <span class="ui-input-group__addon">{{ challenge.question }}</span>
                <input
                  type="text"
                  class="ui-input-group__input"
                  :placeholder="challenge.placeholder"
                  v-model="challengeAnswer"
                  autocomplete="off"
                  required
                >
              </div>
            </div>
          </div>

          <div class="contact-actions">
            <div
              v-if="isConfirmationVisible"
              class="submitted"
              role="status"
              aria-live="polite"
            >
              {{ confirmationText }}
            </div>
            <button class="primary-button contact-submit" type="submit">{{ submitLabel }}</button>
          </div>
          <small id="msg" class="contact-feedback"></small>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup>
import { inject, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { trackEvent } from '../utils/analytics.js';

const title = ref('Contact Us')
const subtitle = ref("Send us a message and we'll keep you updated.")
const formAction = ref('https://docs.google.com/forms/d/e/1FAIpQLSffHYh_hS8zVIA2Dy4ydmFElnrTrpMwgfisZgX8pALvA-d6fw/formResponse')
const submitLabel = ref('Send Message')
const confirmationText = ref('Your message has been sent successfully.')
const isConfirmationVisible = ref(false)
const honeypotMessage = ref('Thanks!')
const pendingMessage = ref('Submitting…')
const successMessage = ref('Thanks! Your message was sent.')
const errorMessage = ref('Sorry—something went wrong. Please try again.')

const SUBMISSION_TOKEN = '';

function getTrackedLocale() {
  try {
    const stored = localStorage.getItem('locale');
    if (stored) return stored;
  } catch (_) {}
  return 'default';
}

const placeholders = reactive({
  name: 'Enter Your Name',
  email: 'Enter Your E-Mail',
  subject: 'Enter Your Subject',
  phone: 'Enter Your Phone',
  message: 'Enter Your Message'
})

// Google Forms hidden fields — fbzx is a required static form parameter, not a secret
const hiddenFields = reactive({
  fvv: '1',
  fbzx: '-6918863791998391765',
  pageHistory: '0'
})

const DEFAULT_CHALLENGE_TYPES = ['arithmetic', 'wordPosition', 'digitSum']

const challenge = reactive({
  label: 'Spam Check',
  placeholder: 'Enter answer',
  instructions: 'Solve the verification prompt to continue.',
  template: 'What is {a} + {b}?',
  question: '',
  errorMessage: 'Please answer the spam check correctly.',
  types: [...DEFAULT_CHALLENGE_TYPES]
})

const challengeAnswer = ref('')

let expectedChallengeAnswer = ''
let activeChallengeType = 'arithmetic'

function secureRandomInt(min, max) {
  const lower = Math.ceil(min)
  const upper = Math.floor(max)
  if (upper <= lower) return lower
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const range = upper - lower + 1
    const maxUint32 = 0xffffffff
    const limit = maxUint32 - (maxUint32 % range)
    const buffer = new Uint32Array(1)
    let randomValue = 0
    do {
      crypto.getRandomValues(buffer)
      randomValue = buffer[0]
    } while (randomValue >= limit)
    return lower + (randomValue % range)
  }
  return lower + Math.floor(Math.random() * (upper - lower + 1))
}

function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return undefined
  const index = secureRandomInt(0, list.length - 1)
  return list[index]
}

const ORDINAL_WORDS = [
  '',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth'
]

const challengeStrategies = {
  arithmetic({ template }) {
    const operator = pickRandom(['+', '-', '×']) || '+'
    let a = secureRandomInt(3, 12)
    let b = secureRandomInt(2, 11)
    let result
    if (operator === '-') {
      if (a < b) [a, b] = [b, a]
      result = a - b
    } else if (operator === '×') {
      a = secureRandomInt(2, 9)
      b = secureRandomInt(2, 9)
      result = a * b
    } else {
      result = a + b
    }
    const questionTemplate = typeof template === 'string' && template.trim()
      ? template
      : 'What is {a} {op} {b}?'
    const question = questionTemplate
      .replace('{a}', a)
      .replace('{b}', b)
      .replace('{op}', operator)
    return {
      question,
      expectedAnswer: String(result)
    }
  },
  wordPosition() {
    const words = ['harmony', 'melody', 'studio', 'galaxy', 'token', 'future', 'signal', 'creative', 'vault', 'design']
    const word = pickRandom(words) || 'harmony'
    const maxIndex = Math.min(word.length, ORDINAL_WORDS.length - 1)
    const position = secureRandomInt(1, Math.max(2, maxIndex))
    const question = `Type the ${ORDINAL_WORDS[position]} letter of "${word.toUpperCase()}".`
    return {
      question,
      expectedAnswer: word.charAt(position - 1)
    }
  },
  digitSum() {
    const value = secureRandomInt(200, 9999)
    const digits = String(value).split('')
    const sum = digits.reduce((acc, digit) => acc + Number(digit || 0), 0)
    return {
      question: `Add the digits of ${value}.`,
      expectedAnswer: String(sum)
    }
  }
}

function normalizeChallengeType(type) {
  if (typeof type !== 'string') return ''
  const normalized = type.replace(/[_\-\s]/g, '').toLowerCase()
  switch (normalized) {
    case 'arithmetic':
    case 'math':
      return 'arithmetic'
    case 'wordposition':
    case 'letter':
    case 'letterposition':
      return 'wordPosition'
    case 'digitsum':
    case 'sumdigits':
    case 'sumofdigits':
      return 'digitSum'
    default:
      return ''
  }
}

function generateChallenge() {
  const configuredTypes = Array.isArray(challenge.types) && challenge.types.length
    ? challenge.types
    : [...DEFAULT_CHALLENGE_TYPES]
  const availableTypes = configuredTypes
    .map(normalizeChallengeType)
    .filter((type) => type && challengeStrategies[type])
  const activeTypes = availableTypes.length ? availableTypes : [...DEFAULT_CHALLENGE_TYPES]
  const chosenType = pickRandom(activeTypes) || 'arithmetic'
  const strategy = challengeStrategies[chosenType] || challengeStrategies.arithmetic
  const { question, expectedAnswer } = strategy({ template: challenge.template })
  challenge.question = question
  expectedChallengeAnswer = expectedAnswer != null ? String(expectedAnswer) : ''
  activeChallengeType = chosenType
}

generateChallenge()

function answersMatch(expected, received) {
  const expectedValue = String(expected ?? '').trim()
  const receivedValue = String(received ?? '').trim()
  if (!expectedValue) return false
  const expectedNumber = Number(expectedValue)
  if (!Number.isNaN(expectedNumber)) {
    const receivedNumber = Number(receivedValue)
    return !Number.isNaN(receivedNumber) && receivedNumber === expectedNumber
  }
  return receivedValue.toLowerCase() === expectedValue.toLowerCase()
}

function isChallengeAnswerCorrect(answer) {
  return answersMatch(expectedChallengeAnswer, answer)
}

let formElement
let submitHandler
let tokenField

const pageContent = inject('pageContent', ref({}))

const defaultTitle = title.value
const defaultSubtitle = subtitle.value
const defaultFormAction = formAction.value
const defaultSubmitLabel = submitLabel.value
const defaultConfirmationText = confirmationText.value
const defaultHoneypot = honeypotMessage.value
const defaultPending = pendingMessage.value
const defaultSuccess = successMessage.value
const defaultError = errorMessage.value
const defaultPlaceholders = { ...placeholders }
const defaultHiddenFields = { ...hiddenFields }
const defaultChallenge = {
  label: challenge.label,
  placeholder: challenge.placeholder,
  instructions: challenge.instructions,
  template: challenge.template,
  errorMessage: challenge.errorMessage,
  types: [...challenge.types]
}

watch(
  () => pageContent.value,
  (content) => {
    const contact = content?.contact ?? {}

    title.value = contact.title ?? defaultTitle
    subtitle.value = contact.subtitle ?? defaultSubtitle

    const formCopy = contact.form ?? {}
    formAction.value = formCopy.action ?? defaultFormAction
    submitLabel.value = formCopy.submitLabel ?? defaultSubmitLabel
    confirmationText.value = formCopy.confirmationText ?? defaultConfirmationText
    isConfirmationVisible.value = false
    honeypotMessage.value = formCopy.honeypotMessage ?? defaultHoneypot
    pendingMessage.value = formCopy.pendingMessage ?? defaultPending
    successMessage.value = formCopy.successMessage ?? defaultSuccess
    errorMessage.value = formCopy.errorMessage ?? defaultError

    const fields = formCopy.fields ?? {}
    placeholders.name = fields.name ?? defaultPlaceholders.name
    placeholders.email = fields.email ?? defaultPlaceholders.email
    placeholders.subject = fields.subject ?? defaultPlaceholders.subject
    placeholders.phone = fields.phone ?? defaultPlaceholders.phone
    placeholders.message = fields.message ?? defaultPlaceholders.message

    const hidden = formCopy.hidden ?? {}
    hiddenFields.fvv = hidden.fvv ?? defaultHiddenFields.fvv
    hiddenFields.fbzx = hidden.fbzx ?? defaultHiddenFields.fbzx
    hiddenFields.pageHistory = hidden.pageHistory ?? defaultHiddenFields.pageHistory

    const challengeCopy = formCopy.challenge ?? {}
    challenge.label = challengeCopy.label ?? defaultChallenge.label
    challenge.placeholder = challengeCopy.placeholder ?? defaultChallenge.placeholder

    challenge.instructions = challengeCopy.instructions ?? defaultChallenge.instructions
    challenge.template = challengeCopy.template ?? defaultChallenge.template
    challenge.errorMessage = challengeCopy.errorMessage ?? defaultChallenge.errorMessage

    const configuredTypes = Array.isArray(challengeCopy.types) && challengeCopy.types.length
      ? challengeCopy.types
      : defaultChallenge.types
    const normalizedTypes = configuredTypes
      .map(normalizeChallengeType)
      .filter(Boolean)
    challenge.types = normalizedTypes.length ? normalizedTypes : [...DEFAULT_CHALLENGE_TYPES]
    challengeAnswer.value = ''
    generateChallenge()
  },
  { immediate: true }
)

onMounted(() => {
  formElement = document.getElementById('signup')
  const msg = document.getElementById('msg')
  tokenField = document.getElementById('siteToken')

  const resetTokenField = () => {
    if (tokenField) {
      tokenField.value = SUBMISSION_TOKEN
      tokenField.defaultValue = SUBMISSION_TOKEN
    }
  }

  resetTokenField()

  if (!formElement || !msg) return

  submitHandler = async (e) => {
    e.preventDefault()
    isConfirmationVisible.value = false

    const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : undefined
    const baseParams = {
      locale: getTrackedLocale()
    }
    const emitSubmitEvent = (status, extra = {}) => {
      const params = { ...baseParams, status, challenge_type: activeChallengeType, ...extra }
      if (startedAt !== undefined && typeof performance !== 'undefined' && typeof performance.now === 'function') {
        params.duration_ms = Math.round(performance.now() - startedAt)
      }
      trackEvent('contact_form_submit', params)
    }

    emitSubmitEvent('attempt')

    const hp = formElement.querySelector('input[name="website"]')
    if (hp && hp.value) {
      msg.textContent = honeypotMessage.value
      formElement.reset()
      challengeAnswer.value = ''
      generateChallenge()
      resetTokenField()
      trackEvent('contact_form_honeypot_triggered', {
        ...baseParams,
        challenge_type: 'honeypot_field'
      })
      return
    }

    if (!isChallengeAnswerCorrect(challengeAnswer.value)) {
      msg.textContent = challenge.errorMessage
      emitSubmitEvent('challenge_failed')
      challengeAnswer.value = ''
      generateChallenge()
      return
    }

    msg.textContent = pendingMessage.value

    try {
      resetTokenField()
      const formData = new FormData(formElement)
      formData.set('entry.1210125274', SUBMISSION_TOKEN)

      await fetch(formElement.action, {
        method: 'POST',
        mode: 'no-cors',
        body: formData
      })
      msg.textContent = successMessage.value
      formElement.reset()
      challengeAnswer.value = ''
      generateChallenge()
      resetTokenField()
      isConfirmationVisible.value = !!(confirmationText.value && confirmationText.value.trim())
      emitSubmitEvent('success')
    } catch (err) {
      console.error('[Contact] Form submission failed:', err)
      msg.textContent = errorMessage.value
      emitSubmitEvent('error', {
        error_name: err?.name || 'unknown',
        error_code: err?.code || 'unknown'
      })
      challengeAnswer.value = ''
      generateChallenge()
      resetTokenField()
    }
  }

  formElement.addEventListener('submit', submitHandler)
})

onUnmounted(() => {
  if (formElement && submitHandler) {
    formElement.removeEventListener('submit', submitHandler)
  }
})
</script>

<style scoped>
.contact-section {
  background: var(--contact-section-bg, var(--theme-body-background, #f7f7f7));
  --section-divider-color: var(--contact-divider-color, var(--brand-border-highlight, rgba(79, 108, 240, 0.28)));
  --section-description-color: var(--contact-description-color, var(--ui-text-muted, rgba(31, 42, 68, 0.72)));
}

.contact-wrapper {
  display: flex;
  justify-content: center;
  width: 100%;
}

.contact-form {
  max-width: 720px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: clamp(20px, 4vw, 32px);
  padding: clamp(24px, 5vw, 40px);
}

.contact-grid {
  display: grid;
  gap: clamp(16px, 3vw, 28px);
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
}

.contact-field--full {
  grid-column: 1 / -1;
}

.contact-label {
  display: block;
  margin-bottom: 6px;
  color: var(--contact-label-color, var(--ui-text-primary, #1f2a44));
}

.contact-hint--inline {
  display: inline-block;
  margin-left: 6px;
}

.contact-actions {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.contact-submit {
  width: min(240px, 100%);
  justify-content: center;
}

.contact-feedback {
  display: block;
  margin-top: 8px;
  text-align: center;
  color: var(--contact-feedback-color, var(--ui-text-muted, rgba(31, 42, 68, 0.72)));
}
</style>
