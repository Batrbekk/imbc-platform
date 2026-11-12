export type Locale = "kk" | "ru" | "en";
const ru = {
  registry: "Реестр производителей Казахстана", platform: "Платформа IMBC",
  description: "Профили компаний и проверенная информация для производителей, операторов и команды IMBC.",
  security: "Доступ к данным зависит от вашей роли. Вход на новом устройстве подтверждается кодом из письма.",
  footer: "IMBC · Платформа взаимодействия с производителями",
  loginTitle: "Войти в IMBC", loginHint: "Используйте электронную почту вашей учётной записи.",
  email: "Электронная почта", username: "Логин или электронная почта", password: "Пароль", signIn: "Войти", remember: "Запомнить меня",
  forgot: "Забыли пароль?", noAccount: "Ещё нет учётной записи?", register: "Зарегистрировать компанию", back: "Вернуться ко входу",
  resetTitle: "Восстановить пароль", resetHint: "Введите вашу электронную почту. Если учётная запись существует, мы отправим ссылку для смены пароля.", sendLink: "Отправить ссылку",
  updateTitle: "Новый пароль", updateHint: "Создайте пароль для вашей учётной записи IMBC.", newPassword: "Новый пароль", confirmPassword: "Повторите пароль", passwordHint: "Не менее 12 символов. Пароль не должен совпадать с электронной почтой или предыдущими паролями.", passwordMismatch: "Пароли должны совпадать", savePassword: "Сохранить пароль", logoutOthers: "После смены пароля другие сеансы будут завершены.",
  verifyTitle: "Подтвердите электронную почту", verifyHint: "Откройте письмо и перейдите по ссылке для подтверждения адреса.", sentTo: "Письмо отправлено на", noEmail: "Письмо не пришло? Проверьте папку «Спам» или отправьте его ещё раз.", resend: "Отправить письмо ещё раз",
  continue: "Продолжить", cancel: "Отмена", doneTitle: "Всё готово", actionTitle: "Подтвердите действие", actionHint: "Продолжите, чтобы завершить настройку учётной записи.", errorTitle: "Не удалось продолжить", errorHint: "Попробуйте войти ещё раз или запросите новую ссылку.", expiredTitle: "Время действия ссылки истекло", expiredHint: "Для защиты вашей учётной записи начните вход заново.", restart: "Начать заново",
  logoutTitle: "Выйти из IMBC?", logoutHint: "Чтобы продолжить работу позже, потребуется войти снова.", logout: "Выйти",
  profileTitle: "Данные учётной записи", profileHint: "Проверьте контактные данные, чтобы продолжить.", firstName: "Имя", lastName: "Фамилия", save: "Сохранить и продолжить", language: "Язык", showPassword: "Показать пароль", hidePassword: "Скрыть пароль", submitting: "Подождите…", codeTitle: "Подтвердите вход", codeHint: "Введите код из приложения для подтверждения входа.", code: "Код подтверждения", chooseMethod: "Выберите способ входа", review: "Проверить данные", linkAccount: "Связать учётную запись", termsTitle: "Условия использования", accept: "Принимаю", decline: "Не принимаю", unavailable: "Этот способ входа недоступен. Вернитесь ко входу, чтобы продолжить.", requiredPassword: "Установка пароля", requiredEmail: "Подтверждение электронной почты", requiredProfile: "Проверка данных", otherAccount: "Войти с другой учётной записью", infoTitle: "Проверьте почту"
};
export type Copy = typeof ru;
export const copy: Record<Locale, Copy> = {
  ru,
  kk: {
    registry: "Қазақстан өндірушілерінің тізілімі", platform: "IMBC платформасы",
    description: "Өндірушілерге, операторларға және IMBC командасына арналған компания профильдері мен тексерілген ақпарат.",
    security: "Деректерге қолжетімділік рөліңізге байланысты. Жаңа құрылғыдан кіру поштаға жіберілген кодпен расталады.",
    footer: "IMBC · Өндірушілермен өзара әрекеттесу платформасы",
    loginTitle: "IMBC платформасына кіру", loginHint: "Тіркелгіңіздің электрондық поштасын пайдаланыңыз.",
    email: "Электрондық пошта", username: "Логин немесе электрондық пошта", password: "Құпиясөз", signIn: "Кіру", remember: "Мені есте сақтау",
    forgot: "Құпиясөзді ұмыттыңыз ба?", noAccount: "Тіркелгіңіз жоқ па?", register: "Компанияны тіркеу", back: "Кіру бетіне оралу",
    resetTitle: "Құпиясөзді қалпына келтіру", resetHint: "Электрондық поштаңызды енгізіңіз. Тіркелгі бар болса, құпиясөзді өзгерту сілтемесін жібереміз.", sendLink: "Сілтемені жіберу",
    updateTitle: "Жаңа құпиясөз", updateHint: "IMBC тіркелгіңіз үшін құпиясөз жасаңыз.", newPassword: "Жаңа құпиясөз", confirmPassword: "Құпиясөзді қайталаңыз", passwordHint: "Кемінде 12 таңба. Құпиясөз электрондық поштаңызбен немесе бұрынғы құпиясөздермен сәйкес келмеуі керек.", passwordMismatch: "Құпиясөздер сәйкес келуі керек", savePassword: "Құпиясөзді сақтау", logoutOthers: "Құпиясөз өзгертілгеннен кейін басқа сеанстар аяқталады.",
    verifyTitle: "Электрондық поштаны растаңыз", verifyHint: "Хатты ашып, мекенжайды растау сілтемесіне өтіңіз.", sentTo: "Хат жіберілген мекенжай", noEmail: "Хат келмеді ме? «Спам» қалтасын тексеріңіз немесе хатты қайта жіберіңіз.", resend: "Хатты қайта жіберу",
    continue: "Жалғастыру", cancel: "Бас тарту", doneTitle: "Дайын", actionTitle: "Әрекетті растаңыз", actionHint: "Тіркелгіні баптауды аяқтау үшін жалғастырыңыз.", errorTitle: "Жалғастыру мүмкін болмады", errorHint: "Қайта кіріңіз немесе жаңа сілтеме сұратыңыз.", expiredTitle: "Сілтеменің мерзімі аяқталды", expiredHint: "Тіркелгіңізді қорғау үшін кіруді қайта бастаңыз.", restart: "Қайта бастау",
    logoutTitle: "IMBC платформасынан шығасыз ба?", logoutHint: "Жұмысты кейін жалғастыру үшін қайта кіру керек.", logout: "Шығу",
    profileTitle: "Тіркелгі деректері", profileHint: "Жалғастыру үшін байланыс деректерін тексеріңіз.", firstName: "Аты", lastName: "Тегі", save: "Сақтау және жалғастыру", language: "Тіл", showPassword: "Құпиясөзді көрсету", hidePassword: "Құпиясөзді жасыру", submitting: "Күте тұрыңыз…", codeTitle: "Кіруді растаңыз", codeHint: "Кіруді растау үшін қолданбадағы кодты енгізіңіз.", code: "Растау коды", chooseMethod: "Кіру тәсілін таңдаңыз", review: "Деректерді тексеру", linkAccount: "Тіркелгіні байланыстыру", termsTitle: "Пайдалану шарттары", accept: "Қабылдаймын", decline: "Қабылдамаймын", unavailable: "Бұл кіру тәсілі қолжетімсіз. Жалғастыру үшін кіру бетіне оралыңыз.", requiredPassword: "Құпиясөзді орнату", requiredEmail: "Электрондық поштаны растау", requiredProfile: "Деректерді тексеру", otherAccount: "Басқа тіркелгімен кіру", infoTitle: "Поштаңызды тексеріңіз"
  },
  en: {
    registry: "Kazakhstan manufacturer registry", platform: "IMBC Platform",
    description: "Company profiles and verified information for manufacturers, operators and the IMBC team.",
    security: "Your role determines access to information. Signing in on a new device requires a code sent by email.",
    footer: "IMBC · Connecting with manufacturers",
    loginTitle: "Sign in to IMBC", loginHint: "Use the email address associated with your account.",
    email: "Email address", username: "Username or email address", password: "Password", signIn: "Sign in", remember: "Remember me",
    forgot: "Forgot password?", noAccount: "Don't have an account?", register: "Register your company", back: "Back to sign in",
    resetTitle: "Reset your password", resetHint: "Enter your email address. If an account exists, we will send a link to reset your password.", sendLink: "Send reset link",
    updateTitle: "Create a new password", updateHint: "Choose a password for your IMBC account.", newPassword: "New password", confirmPassword: "Confirm password", passwordHint: "At least 12 characters. Your password must differ from your email address and previous passwords.", passwordMismatch: "Passwords must match", savePassword: "Save password", logoutOthers: "Changing your password will sign you out on other devices.",
    verifyTitle: "Verify your email", verifyHint: "Open the email and follow the link to verify your address.", sentTo: "Email sent to", noEmail: "No email yet? Check your spam folder or send it again.", resend: "Resend email",
    continue: "Continue", cancel: "Cancel", doneTitle: "You're all set", actionTitle: "Confirm this action", actionHint: "Continue to finish setting up your account.", errorTitle: "We couldn't continue", errorHint: "Try signing in again or request a new link.", expiredTitle: "This link has expired", expiredHint: "To protect your account, please start signing in again.", restart: "Start again",
    logoutTitle: "Sign out of IMBC?", logoutHint: "You will need to sign in again to continue later.", logout: "Sign out",
    profileTitle: "Account details", profileHint: "Check your contact details to continue.", firstName: "First name", lastName: "Last name", save: "Save and continue", language: "Language", showPassword: "Show password", hidePassword: "Hide password", submitting: "Please wait…", codeTitle: "Verify your sign-in", codeHint: "Enter a code from your authenticator app to continue.", code: "Verification code", chooseMethod: "Choose how to sign in", review: "Review details", linkAccount: "Link account", termsTitle: "Terms of use", accept: "Accept", decline: "Decline", unavailable: "This sign-in method is unavailable. Return to sign in to continue.", requiredPassword: "Set a password", requiredEmail: "Verify email", requiredProfile: "Review details", otherAccount: "Use another account", infoTitle: "Check your email"
  }
};
export function getLocale(tag?: string): Locale { return tag?.startsWith("ru") ? "ru" : tag?.startsWith("en") ? "en" : "kk"; }
export const localeNames: Record<Locale, string> = { kk: "Қазақша", ru: "Русский", en: "English" };
