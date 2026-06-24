import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownLeft, ArrowUpRight, BarChart3, CalendarDays, Camera,
  Check, ChevronLeft, ChevronRight, CircleDollarSign, Clock, Cloud, Copy, Download, Edit3, FileText,
  Filter, Image as ImageIcon, LockKeyhole, LogOut, Menu, MessageCircle, MoreHorizontal,
  Phone, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Stethoscope,
  AlertTriangle, ClipboardList, History, LayoutDashboard, Sparkles,
  FileCheck2, Printer, Trash2, Upload, UserPlus, UserRound, Users, WalletCards, X
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from "recharts";
import pdfMake from "pdfmake/build/pdfmake.js";
import pdfFonts from "pdfmake/build/vfs_fonts.js";
import { cloudEnabled, supabase } from "./supabase";
import {
  deleteDocument, deletePatient, deletePhoto, deleteTransaction, deleteVisit, loadClinicData, resetDemo,
  savePatient, saveTransaction, saveVisit, subscribeToClinic, updatePhoto,
  uploadDocuments, uploadPhotos
} from "./data";

pdfMake.addVirtualFileSystem(pdfFonts);

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", maximumFractionDigits: 0
});
const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const pad2 = (value) => String(value).padStart(2, "0");
const localDateISO = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};
const localDateTimeInput = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${localDateISO(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};
const todayISO = () => localDateISO(new Date());
const uuid = () => crypto.randomUUID();
const age = (birthDate) => {
  if (!birthDate) return "—";
  const born = new Date(birthDate);
  const now = new Date();
  let value = now.getFullYear() - born.getFullYear();
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) value--;
  return Math.max(0, value);
};
const safeDate = (value) => value ? shortDate.format(new Date(value)) : "—";
const sum = (items, selector) => items.reduce((total, item) => total + Number(selector(item) || 0), 0);
const treatmentItems = (patient) => Array.isArray(patient?.dental?.treatment_items)
  ? patient.dental.treatment_items
  : [];
const diaryEntries = (patient) => Array.isArray(patient?.dental?.diary_entries)
  ? patient.dental.diary_entries
  : [];
const toothChart = (patient) => patient?.dental?.tooth_chart || {};
const toothStatusCatalog = [
  { value: "Здоров", label: "Здоров", short: "норма", tone: "healthy" },
  { value: "Кариес", label: "Кариес", short: "кар", tone: "danger" },
  { value: "Пульпит", label: "Пульпит", short: "пул", tone: "danger" },
  { value: "Периодонтит", label: "Периодонтит", short: "пер", tone: "danger" },
  { value: "Пломба", label: "Пломба", short: "ПЛ", tone: "previous" },
  { value: "Коронка", label: "Коронка", short: "КР", tone: "crown" },
  { value: "Имплантат", label: "Имплантат", short: "ИМП", tone: "implant" },
  { value: "Канал", label: "Эндо / канал", short: "эндо", tone: "endo" },
  { value: "Запланировано", label: "Запланировано", short: "план", tone: "planned" },
  { value: "В процессе", label: "В процессе", short: "↻", tone: "process" },
  { value: "Выполнено", label: "Выполнено", short: "✓", tone: "done" },
  { value: "Наблюдение", label: "Наблюдение", short: "набл", tone: "watch" },
  { value: "Удалён", label: "Удалён", short: "—", tone: "missing" }
];
const toothStatusMeta = (status = "Здоров") => toothStatusCatalog.find((item) => item.value === status) || toothStatusCatalog[0];
const toothIsProblem = (status = "") => ["Кариес", "Пульпит", "Периодонтит"].includes(status);
const toothDiagnosisOptions = toothStatusCatalog.filter((item) => !["Здоров", "Запланировано", "В процессе", "Выполнено"].includes(item.value));
const normalizeToothDiagnoses = (record = {}) => {
  const values = Array.isArray(record.diagnoses) ? record.diagnoses : [];
  if (record.status && record.status !== "Здоров" && !values.includes(record.status)) values.unshift(record.status);
  return [...new Set(values.filter(Boolean))];
};
const toothPrimaryStatus = (record = {}, fallback = "Здоров") => {
  const diagnoses = normalizeToothDiagnoses(record);
  return diagnoses.find(toothIsProblem) || diagnoses[0] || (record.status && record.status !== "Здоров" ? record.status : fallback);
};
const photoMentionsTooth = (photo, tooth) => {
  const text = `${photo.category || ""} ${photo.comment || ""}`;
  return new RegExp(`(^|\\D)${tooth}(\\D|$)`).test(text);
};
const toothRows = [
  ["Верхняя челюсть", ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"]],
  ["Нижняя челюсть", ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"]]
];
const sameDay = (left, right) => {
  return localDateISO(left) === localDateISO(right);
};
const timeLabel = (value) => new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const visitMinuteKey = (value) => localDateTimeInput(value);
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[character]);
const communicationProfile = (patient) => patient?.dental?.communication || {};
const normalizeTelegramUsername = (value = "") => value.trim().replace(/^@+/, "").replace(/\s+/g, "");
const telegramLink = (username = "") => {
  const clean = normalizeTelegramUsername(username);
  return clean ? `https://t.me/${clean}` : "";
};
const whatsappLink = (phone = "") => {
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return digits.length >= 10 ? `https://wa.me/${digits}` : "";
};
const treatmentTemplates = [
  { name: "Лечение кариеса", price: 0, notes: "Препарирование, медикаментозная обработка, восстановление анатомической формы." },
  { name: "Профессиональная гигиена", price: 0, notes: "Удаление зубных отложений, полировка, рекомендации по домашней гигиене." },
  { name: "Эндодонтическое лечение", price: 0, notes: "Обработка и пломбирование корневых каналов." },
  { name: "Удаление зуба", price: 0, notes: "Хирургический этап и послеоперационные рекомендации." },
  { name: "Имплантация", price: 0, notes: "Хирургический этап установки имплантата." },
  { name: "Ортопедический этап", price: 0, notes: "Подготовка, снятие оттисков/сканирование и фиксация конструкции." }
];
const diaryTemplates = [
  {
    type: "Выполнено",
    title: "Выполнен клинический этап",
    text: "Пациент осмотрен. Проведён запланированный этап лечения. Жалоб после процедуры нет/умеренные. Даны рекомендации.",
    next_step: "Контроль динамики на следующем визите."
  },
  {
    type: "План",
    title: "План на следующий визит",
    text: "На следующем визите планируется продолжение лечения согласно утверждённому плану.",
    next_step: "Согласовать дату и объём следующего этапа."
  },
  {
    type: "Динамика",
    title: "Оценка динамики",
    text: "Отмечается положительная динамика. Состояние тканей/зуба контролируется, жалобы уточнены.",
    next_step: "Продолжить наблюдение и сравнить с предыдущими данными."
  },
  {
    type: "Контроль",
    title: "Контрольный осмотр",
    text: "Проведён контрольный осмотр. Результат лечения стабильный/требует наблюдения.",
    next_step: "Назначить контрольный визит при необходимости."
  }
];
const isIncome = (t) => t.type === "Доход" || t.type === "Коррекция";
const isExpense = (t) => t.type === "Расход" || t.type === "Возврат";
const isDebt = (t) => t.type === "Долг";
const isDiscount = (t) => t.type === "Скидка";
const isSyncedVisitIncome = (t) => t.type === "Доход" && t.visit_id && t.comment === "Оплата визита";
const isSyncedVisitRefund = (t) => t.type === "Возврат" && t.visit_id && t.comment === "Возврат по визиту";
const isManualIncome = (t) => isIncome(t) && !isSyncedVisitIncome(t);
const isManualRefund = (t) => t.type === "Возврат" && !isSyncedVisitRefund(t);
const DEFAULT_VISIT_DURATION_MINUTES = 60;
const MAX_PHOTO_SIZE_MB = 15;
const MAX_PHOTO_SIZE_BYTES = MAX_PHOTO_SIZE_MB * 1024 * 1024;
const validImageTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const validImageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const isAcceptedImageFile = (file) => {
  const name = file.name?.toLowerCase() || "";
  return file.type?.startsWith("image/") || validImageTypes.includes(file.type) || validImageExtensions.some((extension) => name.endsWith(extension));
};
const visitInterval = (value, duration = DEFAULT_VISIT_DURATION_MINUTES) => {
  const start = new Date(value).getTime();
  return { start, end: start + duration * 60000 };
};
const intervalsOverlap = (left, right) => left.start < right.end && right.start < left.end;
const phoneValidationMessage = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/[A-Za-zА-Яа-яЁё]/.test(text)) return "Телефон не должен содержать буквы.";
  const digits = text.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "Телефон должен содержать от 10 до 15 цифр.";
  return "";
};
const normalizePhone = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  let digits = text.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return `+${digits}`;
};

export default function App() {
  const [session, setSession] = useState(cloudEnabled ? null : { user: { email: "demo@cure.app", id: "demo" } });
  const [authReady, setAuthReady] = useState(!cloudEnabled);
  // undefined = проверяем членство, null = у пользователя ещё нет клиники.
  const [membership, setMembership] = useState(cloudEnabled ? undefined : { clinic_id: "demo-clinic", role: "owner" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!cloudEnabled) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (window.location.hash.includes("type=recovery") || window.location.search.includes("type=recovery")) setPasswordRecovery(true);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!cloudEnabled || !session) return;
    setMembership(undefined);
    supabase.from("clinic_members")
      .select("clinic_id, role, full_name, job_title, clinics(id,name,invite_code)")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setToast(`Не удалось проверить клинику: ${error.message}`);
          setMembership(null);
          return;
        }
        setMembership(data ?? null);
      });
  }, [session]);

  const refresh = useCallback(async () => {
    if (!membership?.clinic_id) {
      setLoading(false);
      return;
    }
    try {
      const next = await loadClinicData(membership.clinic_id);
      setData(next);
    } catch (error) {
      setToast(error.message || "Не удалось синхронизировать данные");
    } finally {
      setLoading(false);
    }
  }, [membership?.clinic_id]);

  useEffect(() => {
    setLoading(true);
    refresh();
    if (!membership?.clinic_id) return;
    let timer;
    const unsubscribe = subscribeToClinic(membership.clinic_id, () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 350);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [membership?.clinic_id, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!authReady) return <Splash />;
  if (!session) return <AuthScreen onMessage={setToast} />;
  if (passwordRecovery) return <PasswordUpdateScreen onDone={() => { setPasswordRecovery(false); setToast("Пароль обновлён"); }} />;
  if (cloudEnabled && membership === undefined) return <Splash label="Открываем клинику…" />;
  if (!membership) {
    return <ClinicOnboarding session={session} onJoined={setMembership} onMessage={setToast} />;
  }
  if (loading || !data) return <Splash label="Синхронизация…" />;

  return (
    <>
      <ClinicApp
        session={session}
        membership={membership}
        data={data}
        refresh={refresh}
        notify={setToast}
      />
      {toast && <div className="toast"><Check size={18} />{toast}</div>}
    </>
  );
}

function Splash({ label = "CURE" }) {
  return (
    <main className="splash">
      <BrandMark />
      <h1>{label}</h1>
      <span className="spinner" />
    </main>
  );
}

function BrandMark({ small = false }) {
  return (
    <div className={`brand-mark ${small ? "small" : ""}`}>
      <span className="logo-main">CURE</span>
      <span className="logo-sub">CLINIC</span>
    </div>
  );
}

function AuthScreen({ onMessage }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("Врач-стоматолог");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [registrationComplete, setRegistrationComplete] = useState(false);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setFullName("");
    setInviteCode("");
    setFormError("");
    setRegistrationComplete(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setFormError("Введите адрес электронной почты.");
      return;
    }
    if (mode === "reset") {
      setBusy(true);
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`
      });
      setBusy(false);
      if (error) {
        setFormError(error.message || "Не удалось отправить письмо восстановления.");
      } else {
        setFormError("Мы отправили письмо для восстановления пароля. Проверьте почту и папку «Спам».");
      }
      return;
    }
    if (password.length < 8) {
      setFormError("Пароль должен содержать минимум 8 символов.");
      return;
    }
    if (mode !== "login" && password !== confirmPassword) {
      setFormError("Пароли не совпадают. Проверьте подтверждение пароля.");
      return;
    }
    if (mode === "join" && !inviteCode.trim()) {
      setFormError("Введите код приглашения клиники.");
      return;
    }
    if (mode !== "login" && !fullName.trim()) {
      setFormError("Введите ФИО сотрудника.");
      return;
    }
    setBusy(true);
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
      : await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
            data: {
              full_name: fullName.trim(),
              job_title: jobTitle,
              invite_code: mode === "join" ? inviteCode.trim().toUpperCase() : null
            }
          }
        });
    setBusy(false);
    if (result.error) {
      const message = result.error.message || "Не удалось выполнить операцию.";
      if (message.toLowerCase().includes("already registered")) {
        setFormError("Аккаунт с этой почтой уже существует. Перейдите во вкладку «Войти».");
      } else if (message.toLowerCase().includes("rate limit")) {
        setFormError("Слишком много попыток. Подождите несколько минут и попробуйте снова.");
      } else if (message.toLowerCase().includes("invalid login credentials")) {
        setFormError("Неверная почта или пароль.");
      } else {
        setFormError(`Ошибка: ${message}`);
      }
      return;
    }
    if (mode !== "login") {
      if (Array.isArray(result.data.user?.identities) && result.data.user.identities.length === 0) {
        setFormError("Аккаунт с этой почтой уже существует. Перейдите во вкладку «Войти».");
        return;
      }
      if (result.data.session) {
        onMessage("Аккаунт создан. Добро пожаловать в CURE.");
      } else {
        setRegistrationComplete(true);
      }
    }
  };

  const resendConfirmation = async () => {
    setResendBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`
      }
    });
    setResendBusy(false);
    if (error) {
      onMessage(error.message || "Не удалось повторно отправить письмо");
    } else {
      onMessage("Письмо подтверждения отправлено повторно");
    }
  };

  if (registrationComplete) {
    return (
      <main className="auth-layout">
        <section className="auth-hero">
          <BrandMark />
          <div>
            <p className="eyebrow">СТОМАТОЛОГИЧЕСКАЯ ПРАКТИКА</p>
            <h1>CURE</h1>
            <p>Пациенты, лечение, фотопротоколы и финансы — в одной синхронизированной клинике.</p>
          </div>
          <div className="trust-row">
            <ShieldCheck /><span>Защищённый вход</span>
            <Cloud /><span>Синхронизация устройств</span>
          </div>
        </section>
        <section className="auth-card registration-success">
          <div className="success-icon"><Check /></div>
          <p className="eyebrow">РЕГИСТРАЦИЯ ВЫПОЛНЕНА</p>
          <h2>Подтвердите почту</h2>
          <p className="muted">
            Мы отправили письмо на <strong>{email.trim().toLowerCase()}</strong>.
            Откройте письмо от Supabase и нажмите ссылку подтверждения.
          </p>
          {mode === "join" && <p className="muted">После подтверждения почты вы автоматически войдёте в клинику по коду <strong>{inviteCode.trim().toUpperCase()}</strong>.</p>}
          <div className="auth-help">
            <strong>Письма нет?</strong>
            <span>Проверьте папки «Спам», «Промоакции» и правильность адреса.</span>
          </div>
          <button className="primary wide" onClick={() => changeMode("login")}>Перейти ко входу</button>
          <button className="secondary wide" disabled={resendBusy} onClick={resendConfirmation}>
            {resendBusy ? "Отправляем…" : "Отправить письмо повторно"}
          </button>
          <button className="secondary wide" onClick={() => setRegistrationComplete(false)}>Изменить почту</button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-layout">
      <section className="auth-hero">
        <BrandMark />
        <div>
          <p className="eyebrow">СТОМАТОЛОГИЧЕСКАЯ ПРАКТИКА</p>
          <h1>CURE</h1>
          <p>Пациенты, лечение, фотопротоколы и финансы — в одной синхронизированной клинике.</p>
        </div>
        <div className="trust-row">
          <ShieldCheck /><span>Защищённый вход</span>
          <Cloud /><span>Синхронизация устройств</span>
        </div>
      </section>
      <section className="auth-card">
        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Войти</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")}>Регистрация</button>
          <button className={mode === "join" ? "active" : ""} onClick={() => changeMode("join")}>По коду</button>
        </div>
        <h2>{mode === "login" ? "С возвращением" : mode === "join" ? "Войти в клинику" : mode === "reset" ? "Восстановить пароль" : "Создать аккаунт"}</h2>
        <p className="muted">
          {mode === "login" ? "Войдите в общую клинику CURE." : mode === "join" ? "Введите код клиники, ФИО, должность и данные для личного входа." : mode === "reset" ? "Введите email — мы отправим ссылку для восстановления доступа." : "Создайте аккаунт владельца, а затем новую клинику."}
        </p>
        <form onSubmit={submit} className="stack">
          {mode === "join" && <Field label="Код клиники">
              <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder="CURE-AB12CD" autoComplete="off" />
            </Field>}
          {mode !== "login" && <>
            <Field label="ФИО сотрудника">
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иванов Иван Иванович" autoComplete="name" />
            </Field>
            <Field label="Должность">
              <select value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}>
                {["Врач-стоматолог", "Главный врач", "Медбрат / медсестра", "Ассистент", "Администратор", "Руководитель", "Бухгалтер", "Другое"].map((value) => <option key={value}>{value}</option>)}
              </select>
            </Field>
          </>}
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="doctor@clinic.ru" />
          </Field>
          {mode !== "reset" && (
            <Field label="Пароль">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Минимум 8 символов" />
            </Field>
          )}
          {mode !== "login" && (
            <Field label="Подтверждение пароля">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Введите пароль ещё раз"
              />
            </Field>
          )}
          {formError && <div className="auth-error" role="alert">{formError}</div>}
          <button className="primary wide" disabled={busy}>{busy ? "Подождите…" : mode === "login" ? "Войти в CURE" : mode === "join" ? "Зарегистрироваться и войти по коду" : mode === "reset" ? "Отправить письмо" : "Зарегистрироваться"}</button>
        </form>
        {mode === "login" && <button className="link-button wide" onClick={() => changeMode("reset")}>Забыли пароль?</button>}
        {mode === "reset" && <button className="link-button wide" onClick={() => changeMode("login")}>Вернуться ко входу</button>}
        <p className="privacy-note"><LockKeyhole size={15} /> Медицинские данные доступны только участникам вашей клиники.</p>
      </section>
    </main>
  );
}

function PasswordUpdateScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Пароль должен содержать минимум 8 символов.");
    if (password !== confirmPassword) return setError("Пароли не совпадают.");
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message || "Не удалось обновить пароль.");
      return;
    }
    onDone();
  };
  return (
    <main className="auth-layout">
      <section className="auth-hero">
        <BrandMark />
        <div>
          <p className="eyebrow">ВОССТАНОВЛЕНИЕ ДОСТУПА</p>
          <h1>CURE</h1>
          <p>Введите новый пароль для вашего аккаунта клиники.</p>
        </div>
        <div className="trust-row">
          <ShieldCheck /><span>Защищённый вход</span>
          <LockKeyhole /><span>Новый пароль</span>
        </div>
      </section>
      <section className="auth-card">
        <h2>Новый пароль</h2>
        <p className="muted">Пароль должен содержать минимум 8 символов.</p>
        <form onSubmit={submit} className="stack">
          <Field label="Новый пароль">
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" autoFocus />
          </Field>
          <Field label="Повторите пароль">
            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
          </Field>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="primary wide" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить новый пароль"}</button>
        </form>
      </section>
    </main>
  );
}

function ClinicOnboarding({ session, onJoined, onMessage }) {
  const [tab, setTab] = useState("create");
  const [name, setName] = useState("Моя клиника");
  const [code, setCode] = useState("");
  const [memberName, setMemberName] = useState(session.user.user_metadata?.full_name || "");
  const [memberJobTitle, setMemberJobTitle] = useState(session.user.user_metadata?.job_title || "Врач-стоматолог");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const rpc = tab === "create"
      ? await supabase.rpc("create_clinic", { clinic_name: name })
      : await supabase.rpc("join_clinic_by_code", {
          code: code.trim().toUpperCase(),
          member_name: memberName.trim(),
          member_job_title: memberJobTitle
        });
    setBusy(false);
    if (rpc.error) return onMessage(rpc.error.message);
    const clinicId = rpc.data;
    const { data } = await supabase.from("clinic_members")
      .select("clinic_id, role, full_name, job_title, clinics(id,name,invite_code)")
      .eq("user_id", session.user.id).eq("clinic_id", clinicId).single();
    onJoined(data);
  };

  return (
    <main className="center-page">
      <section className="onboarding-card">
        <BrandMark />
        <h1>Настройка клиники</h1>
        <p className="muted">Все сотрудники одной клиники увидят общих пациентов, визиты, фото и финансы.</p>
        <div className="segmented">
          <button className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>Создать</button>
          <button className={tab === "join" ? "active" : ""} onClick={() => setTab("join")}>Войти по коду</button>
        </div>
        <form className="stack" onSubmit={submit}>
          {tab === "create" ? (
            <Field label="Название клиники"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          ) : (
            <>
              <Field label="Код приглашения"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CURE-AB12CD" required /></Field>
              <Field label="ФИО"><input value={memberName} onChange={(e) => setMemberName(e.target.value)} required /></Field>
              <Field label="Должность"><select value={memberJobTitle} onChange={(e) => setMemberJobTitle(e.target.value)}>
                {["Врач-стоматолог", "Главный врач", "Медбрат / медсестра", "Ассистент", "Администратор", "Руководитель", "Бухгалтер", "Другое"].map((value) => <option key={value}>{value}</option>)}
              </select></Field>
            </>
          )}
          <button className="primary wide" disabled={busy}>{busy ? "Подождите…" : tab === "create" ? "Создать клинику" : "Присоединиться"}</button>
        </form>
      </section>
    </main>
  );
}

function ClinicApp({ session, membership, data, refresh, notify }) {
  const [route, setRoute] = useState("today");
  const [selectedId, setSelectedId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedPatient = data.patients.find((p) => p.id === selectedId);

  const openPatient = (id) => {
    setSelectedId(id);
    setRoute("patient");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goBack = () => {
    setRoute("patients");
    setSelectedId(null);
  };
  const goToday = () => {
    setRoute("today");
    setSelectedId(null);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-inline" onClick={goBack}>
          <BrandMark small />
          <div><span>{data.clinic.name}</span></div>
        </div>
        <div className="sync-state"><span className={cloudEnabled ? "online" : "demo"} />{cloudEnabled ? "Синхронизировано" : "Демо-режим"}</div>
        <button className="icon-button avatar" onClick={() => setSettingsOpen(true)} aria-label="Настройки">
          {session.user.email?.slice(0, 1).toUpperCase() || <Menu />}
        </button>
      </header>

      <main className="app-content">
        {route === "today" && (
          <TodayPage data={data} clinicId={membership.clinic_id} refresh={refresh} notify={notify} openPatient={openPatient} />
        )}
        {route === "patients" && (
          <PatientsPage data={data} clinicId={membership.clinic_id} refresh={refresh} openPatient={openPatient} notify={notify} />
        )}
        {route === "patient" && selectedPatient && (
          <PatientPage patient={selectedPatient} data={data} clinicId={membership.clinic_id} refresh={refresh} back={goBack} notify={notify} />
        )}
        {route === "finance" && (
          <FinancePage data={data} clinicId={membership.clinic_id} refresh={refresh} notify={notify} />
        )}
        {route === "calendar" && (
          <CalendarPage data={data} clinicId={membership.clinic_id} refresh={refresh} notify={notify} openPatient={openPatient} />
        )}
      </main>

      <nav className="tabbar">
        <button className={route === "today" ? "active" : ""} onClick={goToday}>
          <LayoutDashboard /><span>Сегодня</span>
        </button>
        <button className={route === "patients" || route === "patient" ? "active" : ""} onClick={goBack}>
          <Users /><span>Пациенты</span>
        </button>
        <button className={route === "calendar" ? "active" : ""} onClick={() => { setRoute("calendar"); setSelectedId(null); }}>
          <CalendarDays /><span>Календарь</span>
        </button>
        <button className={route === "finance" ? "active" : ""} onClick={() => setRoute("finance")}>
          <BarChart3 /><span>Финансы</span>
        </button>
      </nav>

      {settingsOpen && (
        <SettingsSheet
          session={session} membership={membership} clinic={data.clinic}
          close={() => setSettingsOpen(false)} notify={notify}
        />
      )}
    </div>
  );
}

function TodayPage({ data, clinicId, refresh, notify, openPatient }) {
  const [visitEditor, setVisitEditor] = useState(null);
  const now = new Date();
  const appointments = data.visits
    .filter((visit) => sameDay(visit.date, now))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const upcoming = data.visits
    .filter((visit) => new Date(visit.date) > now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);
  const activePlans = data.patients.filter((patient) =>
    treatmentItems(patient).some((item) => !["Выполнено", "Отменено"].includes(item.status))
  );
  const riskyPatients = data.patients.filter((patient) => patientWarnings(patient).length);

  return (
    <section>
      <PageHeader
        title="Сегодня"
        subtitle={now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
      />
      <div className="today-metrics">
        <Metric title="Приёмов сегодня" value={appointments.length} icon={<CalendarDays />} />
        <Metric title="Активных планов" value={activePlans.length} icon={<ClipboardList />} />
        <Metric title="Пациентов с рисками" value={riskyPatients.length} tone={riskyPatients.length ? "red" : "green"} icon={<AlertTriangle />} />
      </div>
      <div className="today-layout">
        <div className="section-block">
          <div className="section-heading"><div><h2>Расписание дня</h2><p>{appointments.length ? `${appointments.length} приёмов` : "Свободный день"}</p></div></div>
          {appointments.length ? appointments.map((visit) => {
            const patient = data.patients.find((item) => item.id === visit.patient_id);
            if (!patient) return null;
            const warnings = patientWarnings(patient);
            return (
              <button className="appointment-card" key={visit.id} onClick={() => setVisitEditor({ visit, patient })}>
                <span className="appointment-time">{timeLabel(visit.date)}</span>
                <span className="appointment-main">
                  <strong>{patient.full_name}</strong>
                  <small>{visit.treatment_type} · {visit.teeth || "Область не указана"}</small>
                  <small className="visit-edit-hint">Нажмите, чтобы изменить запись</small>
                  {warnings.length > 0 && <em><AlertTriangle />{warnings[0]}</em>}
                </span>
                <Edit3 />
              </button>
            );
          }) : <Empty icon={<CalendarDays />} title="Сегодня приёмов нет" text="Будущие визиты появятся здесь автоматически." />}
        </div>
        <div className="section-block">
          <div className="section-heading"><div><h2>Ближайшие визиты</h2><p>Следующие записи</p></div></div>
          <div className="upcoming-list">
            {upcoming.length ? upcoming.map((visit) => {
              const patient = data.patients.find((item) => item.id === visit.patient_id);
              return patient && (
                <button key={visit.id} onClick={() => setVisitEditor({ visit, patient })}>
                  <span>{safeDate(visit.date)} · {timeLabel(visit.date)}</span>
                  <strong>{patient.full_name}</strong>
                  <small>{visit.treatment_type}</small>
                </button>
              );
            }) : <p className="muted">Будущих визитов пока нет.</p>}
          </div>
        </div>
      </div>
      {visitEditor && (
        <VisitEditor
          patient={visitEditor.patient}
          visit={visitEditor.visit}
          visits={data.visits}
          clinicId={clinicId}
          onClose={() => setVisitEditor(null)}
          onOpenPatient={() => openPatient(visitEditor.patient.id)}
          onSaved={async () => { await refresh(); setVisitEditor(null); notify("Визит сохранён"); }}
          onDeleted={async () => { await refresh(); setVisitEditor(null); notify("Визит удалён"); }}
        />
      )}
    </section>
  );
}

function CalendarPage({ data, clinicId, refresh, notify, openPatient }) {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [editorPatient, setEditorPatient] = useState(null);
  const [visitEditor, setVisitEditor] = useState(null);
  const [monthCursor, setMonthCursor] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date;
  });
  const monthStart = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const monthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
  const leadingDays = (monthStart.getDay() + 6) % 7;
  const calendarCells = Array.from({ length: Math.ceil((leadingDays + monthEnd.getDate()) / 7) * 7 }, (_, index) => {
    const date = new Date(monthStart);
    date.setDate(index - leadingDays + 1);
    return date;
  });
  const monthLabel = monthCursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  const years = Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - 5 + index);
  const visits = data.visits
    .filter((visit) => sameDay(visit.date, selectedDate))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const monthVisits = data.visits.filter((visit) => {
    const date = new Date(visit.date);
    return date.getFullYear() === monthCursor.getFullYear() && date.getMonth() === monthCursor.getMonth();
  });

  const shiftMonth = (delta) => {
    const next = new Date(monthCursor);
    next.setMonth(next.getMonth() + delta);
    next.setDate(1);
    setMonthCursor(next);
    setSelectedDate(localDateISO(next));
  };

  const jumpToday = () => {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    setMonthCursor(first);
    setSelectedDate(todayISO());
  };

  const setMonth = (value) => {
    const next = new Date(monthCursor);
    next.setMonth(Number(value));
    next.setDate(1);
    setMonthCursor(next);
    setSelectedDate(localDateISO(next));
  };

  const setYear = (value) => {
    const next = new Date(monthCursor);
    next.setFullYear(Number(value));
    next.setDate(1);
    setMonthCursor(next);
    setSelectedDate(localDateISO(next));
  };

  return (
    <section>
      <PageHeader title="Календарь" subtitle={`${monthLabel} · ${monthVisits.length} записей`}>
        <select className="simple-select" value={editorPatient?.id || ""} onChange={(event) => setEditorPatient(data.patients.find((p) => p.id === event.target.value) || null)}>
          <option value="">+ Назначить визит</option>
          {data.patients.map((patient) => <option value={patient.id} key={patient.id}>{patient.full_name}</option>)}
        </select>
      </PageHeader>
      <div className="calendar-toolbar card">
        <button className="secondary" onClick={() => shiftMonth(-1)}><ChevronLeft />Предыдущий</button>
        <div className="calendar-selectors">
          <select value={monthCursor.getMonth()} onChange={(event) => setMonth(event.target.value)}>
            {Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{new Date(2026, month, 1).toLocaleDateString("ru-RU", { month: "long" })}</option>)}
          </select>
          <select value={monthCursor.getFullYear()} onChange={(event) => setYear(event.target.value)}>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        <button className="secondary" onClick={jumpToday}>Сегодня</button>
        <button className="secondary" onClick={() => shiftMonth(1)}>Следующий<ChevronRight /></button>
      </div>
      <div className="calendar-month card">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span className="calendar-weekday" key={day}>{day}</span>)}
        {calendarCells.map((date) => {
          const iso = localDateISO(date);
          const count = data.visits.filter((visit) => sameDay(visit.date, date)).length;
          const outside = date.getMonth() !== monthCursor.getMonth();
          return (
            <button key={iso} className={`${selectedDate === iso ? "active" : ""} ${outside ? "outside" : ""}`} onClick={() => setSelectedDate(iso)}>
              <strong>{date.getDate()}</strong>
              {count > 0 && <span>{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="section-heading calendar-heading">
        <div><h2>{safeDate(selectedDate)}</h2><p>{visits.length} записей</p></div>
      </div>
      <div className="calendar-day">
        {visits.length ? visits.map((visit) => {
          const patient = data.patients.find((item) => item.id === visit.patient_id);
          return patient && (
            <button className="appointment-card" key={visit.id} onClick={() => setVisitEditor({ visit, patient })}>
              <span className="appointment-time">{timeLabel(visit.date)}</span>
              <span className="appointment-main"><strong>{patient.full_name}</strong><small>{visit.treatment_type} · {visit.visit_kind || "Визит"}</small><small className="visit-edit-hint">Нажмите, чтобы изменить или удалить запись</small></span>
              <Edit3 />
            </button>
          );
        }) : <Empty icon={<CalendarDays />} title="Записей нет" text="Выберите пациента сверху, чтобы назначить визит." />}
      </div>
      {editorPatient && (
        <VisitEditor
          patient={editorPatient}
          presetDate={`${selectedDate}T09:00`}
          visits={data.visits}
          clinicId={clinicId}
          onClose={() => setEditorPatient(null)}
          onSaved={async () => { await refresh(); setEditorPatient(null); notify("Визит назначен"); }}
        />
      )}
      {visitEditor && (
        <VisitEditor
          patient={visitEditor.patient}
          visit={visitEditor.visit}
          visits={data.visits}
          clinicId={clinicId}
          onClose={() => setVisitEditor(null)}
          onOpenPatient={() => openPatient(visitEditor.patient.id)}
          onSaved={async () => { await refresh(); setVisitEditor(null); notify("Визит сохранён"); }}
          onDeleted={async () => { await refresh(); setVisitEditor(null); notify("Визит удалён"); }}
        />
      )}
    </section>
  );
}

function PatientsPage({ data, clinicId, refresh, openPatient, notify }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Все");
  const [sort, setSort] = useState("Последний визит");
  const [editor, setEditor] = useState(false);

  const patients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.patients
      .filter((patient) => {
        const visits = data.visits.filter((v) => v.patient_id === patient.id);
        const planItems = treatmentItems(patient).flatMap((item) => [item.name, item.teeth, item.notes, item.status]);
        const communication = communicationProfile(patient);
        const representative = communication.representative || {};
        const haystack = [
          patient.full_name, patient.phone, patient.second_phone, patient.dental?.diagnosis, patient.dental?.treatment_plan,
          communication.telegram_username, communication.preferred_channel, communication.contact_note, communication.follow_up_reason,
          representative.name, representative.phone, representative.telegram,
          ...planItems, ...visits.map((v) => v.treatment_type)
        ].join(" ").toLowerCase();
        return (!q || haystack.includes(q)) && (status === "Все" || patient.status === status);
      })
      .sort((a, b) => {
        if (sort === "ФИО") return a.full_name.localeCompare(b.full_name, "ru");
        const metric = (patient) => {
          const visits = data.visits.filter((v) => v.patient_id === patient.id);
          if (sort === "Задолженность") return patientFinancials(patient.id, data).debt;
          return Math.max(0, ...visits.map((v) => new Date(v.date).getTime()));
        };
        return metric(b) - metric(a);
      });
  }, [data, query, status, sort]);

  return (
    <section>
      <PageHeader title="Пациенты" subtitle={`${data.patients.length} в базе`}>
        <button className="primary" onClick={() => setEditor(true)}><Plus />Добавить</button>
      </PageHeader>
      <div className="toolbar-row">
        <label className="search"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ФИО, телефон, диагноз, лечение" /></label>
        <label className="select-control"><Filter /><select value={status} onChange={(e) => setStatus(e.target.value)}>
          {["Все", "Новый", "На лечении", "Завершён", "Контроль", "Должник", "Архив"].map((v) => <option key={v}>{v}</option>)}
        </select></label>
        <select className="simple-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          {["Последний визит", "ФИО", "Задолженность"].map((v) => <option key={v}>{v}</option>)}
        </select>
      </div>
      {patients.length ? (
        <div className="patient-grid">
          {patients.map((patient) => (
            <PatientCard key={patient.id} patient={patient} data={data} onClick={() => openPatient(patient.id)} />
          ))}
        </div>
      ) : (
        <Empty icon={<Users />} title="Пациентов пока нет" text="Добавьте первого пациента — карточка сразу появится на всех устройствах клиники." action={() => setEditor(true)} />
      )}
      {editor && <PatientEditor visits={data.visits} clinicId={clinicId} onClose={() => setEditor(false)} onSaved={async (message) => { await refresh(); setEditor(false); notify(message || "Пациент сохранён"); }} />}
    </section>
  );
}

function PatientCard({ patient, data, onClick }) {
  const visits = data.visits.filter((v) => v.patient_id === patient.id);
  const latest = visits.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const finance = patientFinancials(patient.id, data);
  const photo = data.photos.find((p) => p.patient_id === patient.id);
  const communication = communicationProfile(patient);
  const telegram = normalizeTelegramUsername(communication.telegram_username);
  return (
    <button className="patient-card" onClick={onClick}>
      <div className="patient-photo">
        {photo?.signed_url ? <img src={photo.signed_url} alt="" /> : <UserRound />}
      </div>
      <div className="patient-main">
        <div className="card-title-row">
          <div><h3>{patient.full_name}</h3><p>{age(patient.birth_date)} лет · {patient.phone || "Телефон не указан"}</p></div>
          <StatusBadge status={finance.debt > 0 ? "Должник" : patient.status} />
        </div>
        {(telegram || communication.follow_up_needed) && (
          <div className="patient-contact-tags">
            {telegram && <span><Send />@{telegram}</span>}
            {communication.follow_up_needed && <span className="attention"><MessageCircle />Нужно связаться</span>}
          </div>
        )}
        <div className="patient-meta">
          <span><CalendarDays />{latest ? safeDate(latest.date) : "Визитов нет"}</span>
          <strong>{money.format(finance.cost)}</strong>
        </div>
        <div className="finance-line">
          <span className="positive">Оплачено {money.format(finance.paid)}</span>
          <span className={finance.debt > 0 ? "negative" : "positive"}>{finance.debt > 0 ? `Долг ${money.format(finance.debt)}` : "Оплачено"}</span>
        </div>
      </div>
    </button>
  );
}

function PatientPage({ patient, data, clinicId, refresh, back, notify }) {
  const [section, setSection] = useState("Обзор");
  const [editPatient, setEditPatient] = useState(false);
  const [visitEditor, setVisitEditor] = useState(null);
  const [photoEditor, setPhotoEditor] = useState(false);
  const [txEditor, setTxEditor] = useState(false);
  const [treatmentEditor, setTreatmentEditor] = useState(null);
  const [toothEditor, setToothEditor] = useState(null);
  const [documentUploader, setDocumentUploader] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const finance = patientFinancials(patient.id, data);
  const visits = data.visits.filter((v) => v.patient_id === patient.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const photos = data.photos.filter((p) => p.patient_id === patient.id);
  const documents = (data.documents || []).filter((document) => document.patient_id === patient.id);
  const warnings = patientWarnings(patient);
  const communication = communicationProfile(patient);
  const telegramUrl = telegramLink(communication.telegram_username);
  const whatsappUrl = whatsappLink(patient.phone);

  const remove = async () => {
    if (!confirm("Удалить пациента, все визиты, финансы и фотографии безвозвратно?")) return;
    await deletePatient(clinicId, patient.id, photos, documents);
    await refresh();
    notify("Пациент удалён");
    back();
  };

  const changeStatus = async (nextStatus) => {
    if (nextStatus === patient.status) return;
    setStatusBusy(true);
    try {
      await savePatient(clinicId, { ...patient, status: nextStatus });
      await refresh();
      notify(`Статус изменён: ${nextStatus}`);
    } catch (error) {
      notify(error.message || "Не удалось изменить статус");
    } finally {
      setStatusBusy(false);
    }
  };

  const copyText = async (value, message) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify("Не удалось скопировать");
    }
  };

  return (
    <section>
      <div className="detail-nav">
        <button className="back-button" onClick={back}><ChevronLeft />Пациенты</button>
        <div className="detail-actions">
          {patient.phone && <a className="icon-button" href={`tel:${patient.phone}`}><Phone /></a>}
          {telegramUrl && <a className="icon-button" href={telegramUrl} target="_blank" rel="noreferrer"><Send /></a>}
          <button className="icon-button" onClick={() => setEditPatient(true)}><Edit3 /></button>
          <button className="icon-button danger-ghost" onClick={remove}><Trash2 /></button>
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="clinical-alerts">
          {warnings.map((warning) => <div key={warning}><AlertTriangle /><span>{warning}</span></div>)}
        </div>
      )}
      <div className="patient-hero card">
        <div>
          <p className="eyebrow">КАРТОЧКА ПАЦИЕНТА</p>
          <h1>{patient.full_name}</h1>
          <p>{age(patient.birth_date)} лет · {patient.phone || "Телефон не указан"}</p>
          {(communication.important_note || communication.follow_up_needed || communication.preferred_channel) && (
            <div className="patient-insights">
              {communication.important_note && <span className="insight-pill important"><AlertTriangle />{communication.important_note}</span>}
              {communication.follow_up_needed && <span className="insight-pill"><MessageCircle />Нужно связаться{communication.next_contact_date ? ` · ${safeDate(communication.next_contact_date)}` : ""}</span>}
              {communication.preferred_channel && <span className="insight-pill muted-pill">{communication.preferred_channel}</span>}
            </div>
          )}
          <div className="patient-status-control">
            <StatusBadge status={finance.debt > 0 ? "Должник" : patient.status} />
            <label>
              <span>Статус лечения</span>
              <select value={patient.status} disabled={statusBusy} onChange={(event) => changeStatus(event.target.value)}>
                {["Новый", "На лечении", "Завершён", "Контроль", "Должник", "Архив"].map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="metric-grid compact">
          <Metric title="Стоимость" value={money.format(finance.cost)} icon={<FileText />} />
          <Metric title="Оплачено" value={money.format(finance.paid)} tone="green" icon={<Check />} />
          <Metric title="Долг" value={money.format(finance.debt)} tone={finance.debt ? "red" : "green"} icon={<CircleDollarSign />} />
          <Metric title="Чистая выручка" value={money.format(finance.net)} icon={<WalletCards />} />
        </div>
      </div>
      <div className="quick-actions">
        <button onClick={() => setVisitEditor({})}><CalendarDays /><span>Новый визит</span></button>
        <button onClick={() => setTreatmentEditor({})}><ClipboardList /><span>В план</span></button>
        <button onClick={() => setPhotoEditor(true)}><Camera /><span>Фото</span></button>
        <button onClick={() => setTxEditor(true)}><WalletCards /><span>Оплата</span></button>
        {telegramUrl && <a href={telegramUrl} target="_blank" rel="noreferrer"><Send /><span>Telegram</span></a>}
        {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer"><MessageCircle /><span>WhatsApp</span></a>}
      </div>
      <div className="chip-scroll">
        {["Обзор", "Связь", "Дневник", "Зубная формула", "История", "Рекомендации", "Документы", "Анамнез", "Лечение", "Финансы", "Фото", "Заметки"].map((item) => (
          <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item}</button>
        ))}
      </div>

      {section === "Обзор" && (
        <Overview
          patient={patient}
          visits={visits}
          finance={finance}
          onAddTreatment={() => setTreatmentEditor({})}
          onEditTreatment={setTreatmentEditor}
        />
      )}
      {section === "Связь" && (
        <CommunicationSection
          patient={patient}
          clinicId={clinicId}
          refresh={refresh}
          notify={notify}
          onEdit={() => setEditPatient(true)}
          onCopy={copyText}
        />
      )}
      {section === "Дневник" && <PatientDiary patient={patient} clinicId={clinicId} refresh={refresh} notify={notify} />}
      {section === "Анамнез" && <Anamnesis patient={patient} />}
      {section === "Зубная формула" && (
        <DentalChart patient={patient} data={data} onSelect={setToothEditor} />
      )}
      {section === "История" && (
        <PatientTimeline patient={patient} data={data} />
      )}
      {section === "Документы" && (
        <DocumentsSection
          patient={patient}
          clinic={data.clinic}
          visits={visits}
          documents={documents}
          clinicId={clinicId}
          onUpload={() => setDocumentUploader(true)}
          refresh={refresh}
          notify={notify}
        />
      )}
      {section === "Рекомендации" && (
        <RecommendationsSection patient={patient} clinic={data.clinic} visits={visits} clinicId={clinicId} refresh={refresh} notify={notify} />
      )}
      {section === "Лечение" && (
        <VisitsSection visits={visits} transactions={data.transactions} onAdd={() => setVisitEditor({})} onEdit={setVisitEditor} />
      )}
      {section === "Финансы" && (
        <PatientFinance patient={patient} data={data} finance={finance} onAdd={() => setTxEditor(true)} />
      )}
      {section === "Фото" && (
        <PhotosSection photos={photos} visits={visits} onAdd={() => setPhotoEditor(true)} refresh={refresh} notify={notify} />
      )}
      {section === "Заметки" && (
        <NotesSection patient={patient} clinicId={clinicId} refresh={refresh} notify={notify} />
      )}

      {editPatient && <PatientEditor patient={patient} visits={data.visits} clinicId={clinicId} onClose={() => setEditPatient(false)} onSaved={async (message) => { await refresh(); setEditPatient(false); notify(message || "Карточка обновлена"); }} />}
      {visitEditor && <VisitEditor patient={patient} visit={visitEditor.id ? visitEditor : null} visits={data.visits} clinicId={clinicId} onClose={() => setVisitEditor(null)} onSaved={async () => { await refresh(); setVisitEditor(null); notify("Визит сохранён"); }} />}
      {photoEditor && <PhotoUploader patient={patient} visits={visits} clinicId={clinicId} onClose={() => setPhotoEditor(false)} onSaved={async () => { await refresh(); setPhotoEditor(false); notify("Фотографии добавлены"); }} />}
      {txEditor && <TransactionEditor patients={data.patients} visits={data.visits} transactions={data.transactions} presetPatient={patient} clinicId={clinicId} onClose={() => setTxEditor(false)} onSaved={async () => { await refresh(); setTxEditor(false); notify("Финансовая запись сохранена"); }} />}
      {treatmentEditor && (
        <TreatmentPlanEditor
          patient={patient}
          item={treatmentEditor.id ? treatmentEditor : null}
          clinicId={clinicId}
          onClose={() => setTreatmentEditor(null)}
          onSaved={async (message) => {
            await refresh();
            setTreatmentEditor(null);
            notify(message);
          }}
        />
      )}
      {toothEditor && (
        <ToothEditor
          patient={patient}
          tooth={toothEditor}
          data={data}
          clinicId={clinicId}
          onClose={() => setToothEditor(null)}
          onSaved={async () => { await refresh(); setToothEditor(null); notify("Зубная формула обновлена"); }}
          onPhotoSaved={async () => { await refresh(); notify("Фото добавлено к зубу"); }}
        />
      )}
      {documentUploader && (
        <DocumentUploader
          patient={patient}
          clinicId={clinicId}
          onClose={() => setDocumentUploader(false)}
          onSaved={async () => { await refresh(); setDocumentUploader(false); notify("Документы добавлены"); }}
        />
      )}
    </section>
  );
}

function Overview({ patient, visits, finance, onAddTreatment, onEditTreatment }) {
  const latest = visits[0];
  const next = visits.filter((v) => v.next_visit_date && new Date(v.next_visit_date) >= new Date()).sort((a, b) => new Date(a.next_visit_date) - new Date(b.next_visit_date))[0];
  const plan = treatmentItems(patient);
  const planTotal = sum(plan.filter((item) => item.status !== "Отменено"), (item) => item.price);
  const communication = communicationProfile(patient);
  const telegram = normalizeTelegramUsername(communication.telegram_username);
  return (
    <div className="detail-grid">
      <InfoCard title="Основные данные" icon={<UserRound />}>
        <InfoRow label="Телефон" value={patient.phone || "—"} />
        <InfoRow label="Telegram" value={telegram ? `@${telegram}` : "—"} />
        <InfoRow label="Источник" value={patient.source || "—"} />
        <InfoRow label="Последний визит" value={latest ? safeDate(latest.date) : "—"} />
        <InfoRow label="Следующий визит" value={next ? safeDate(next.next_visit_date) : "Не назначен"} />
      </InfoCard>
      <InfoCard title="Связь" icon={<MessageCircle />}>
        <InfoRow label="Предпочтительно" value={communication.preferred_channel || "—"} />
        <InfoRow label="Комментарий" value={communication.contact_note || "—"} />
        <InfoRow label="Нужно связаться" value={communication.follow_up_needed ? (communication.follow_up_reason || "Да") : "Нет"} />
        <InfoRow label="Следующий контакт" value={communication.next_contact_date ? safeDate(communication.next_contact_date) : "—"} />
      </InfoCard>
      <article className="info-card treatment-plan-card">
        <header>
          <Stethoscope />
          <h3>План лечения</h3>
          <button className="treatment-add" onClick={onAddTreatment} aria-label="Добавить пункт плана лечения" title="Добавить пункт">
            <Plus />
          </button>
        </header>
        <div>
          {patient.dental?.treatment_plan && <p className="treatment-plan-note">{patient.dental.treatment_plan}</p>}
          {plan.length ? (
            <>
              <div className="treatment-plan-list">
                {plan.map((item, index) => (
                  <button className="treatment-plan-item" key={item.id} onClick={() => onEditTreatment(item)}>
                    <span className="treatment-plan-number">{index + 1}</span>
                    <span className="treatment-plan-content">
                      <strong>{item.name}</strong>
                      <small>
                        {[item.teeth && `Зуб / область: ${item.teeth}`, item.status || "Запланировано"].filter(Boolean).join(" · ")}
                      </small>
                    </span>
                    <span className="treatment-plan-price">{money.format(item.price || 0)}</span>
                    <Edit3 className="treatment-plan-edit" />
                  </button>
                ))}
              </div>
              <div className="treatment-plan-total">
                <span>Итого по плану</span>
                <strong>{money.format(planTotal)}</strong>
              </div>
            </>
          ) : (
            <button className="treatment-plan-empty" onClick={onAddTreatment}>
              <Plus />
              <span>Добавить первый этап лечения</span>
            </button>
          )}
        </div>
      </article>
      <InfoCard title="Клинический статус" icon={<Activity />}>
        <InfoRow label="Диагноз" value={patient.dental?.diagnosis || "—"} />
        <InfoRow label="FDI" value={patient.dental?.fdi_teeth || "—"} />
        <InfoRow label="Визитов" value={visits.length} />
        <InfoRow label="Записей дневника" value={diaryEntries(patient).length} />
        <InfoRow label="Финансовый статус" value={finance.debt > 0 ? `Долг ${money.format(finance.debt)}` : "Оплачено"} />
      </InfoCard>
    </div>
  );
}

function TreatmentPlanEditor({ patient, item, clinicId, onClose, onSaved }) {
  const [form, setForm] = useState(item ? structuredClone(item) : {
    name: "", teeth: "", price: "", status: "Запланировано", notes: ""
  });
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const persist = async (nextItems, message) => {
    setBusy(true);
    try {
      await savePatient(clinicId, {
        ...patient,
        dental: { ...(patient.dental || {}), treatment_items: nextItems }
      });
      await onSaved(message);
    } catch (error) {
      alert(error.message || "Не удалось сохранить план лечения");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const price = Number(form.price || 0);
    if (!name) return alert("Напишите, что нужно сделать");
    if (price < 0) return alert("Цена не может быть отрицательной");
    const nextItem = {
      ...form,
      id: item?.id || uuid(),
      created_at: item?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      name,
      teeth: form.teeth.trim(),
      notes: form.notes.trim(),
      price
    };
    const currentItems = treatmentItems(patient);
    const nextItems = item
      ? currentItems.map((current) => current.id === item.id ? nextItem : current)
      : [...currentItems, nextItem];
    await persist(nextItems, item ? "Этап лечения обновлён" : "Этап лечения добавлен");
  };

  const remove = async () => {
    if (!item || !confirm(`Удалить из плана «${item.name}»?`)) return;
    await persist(treatmentItems(patient).filter((current) => current.id !== item.id), "Этап лечения удалён");
  };

  return (
    <Modal title={item ? "Изменить этап лечения" : "Новый этап лечения"} onClose={onClose}>
      <form onSubmit={submit}>
        {!item && (
          <div className="template-picker">
            <span><Sparkles />Быстрый шаблон</span>
            <div>{treatmentTemplates.map((template) => (
              <button type="button" key={template.name} onClick={() => setForm((current) => ({ ...current, ...template }))}>
                {template.name}
              </button>
            ))}</div>
          </div>
        )}
        <div className="form-grid">
          <Field label="Что делаем *" full>
            <input value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Например: лечение кариеса" autoFocus />
          </Field>
          <Field label="Зуб / область">
            <input value={form.teeth || ""} onChange={(event) => set("teeth", event.target.value)} placeholder="Например: 16" />
          </Field>
          <Field label="Цена">
            <input type="number" min="0" step="1" inputMode="decimal" value={form.price} onChange={(event) => set("price", event.target.value)} placeholder="0" />
          </Field>
          <Field label="Статус" full>
            <select value={form.status} onChange={(event) => set("status", event.target.value)}>
              {["Запланировано", "В процессе", "Выполнено", "Отменено"].map((status) => <option key={status}>{status}</option>)}
            </select>
          </Field>
          <Field label="Комментарий" full>
            <textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)} placeholder="Материалы, последовательность или другие детали" />
          </Field>
        </div>
        <div className="modal-actions treatment-editor-actions">
          {item && <button type="button" className="danger-action" disabled={busy} onClick={remove}><Trash2 />Удалить</button>}
          <span />
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Отмена</button>
          <button className="primary" disabled={busy}>{busy ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </form>
    </Modal>
  );
}

function toothClinicalContext(patient, data = {}, tooth) {
  const chart = toothChart(patient);
  const record = chart[tooth] || {};
  const plan = treatmentItems(patient).filter((item) => extractPlanTeeth(`${item.teeth || ""} ${item.notes || ""}`).includes(tooth));
  const activePlan = plan.filter((item) => item.status !== "Отменено");
  const diary = diaryEntries(patient).filter((entry) => extractPlanTeeth(`${entry.teeth || ""} ${entry.title || ""} ${entry.text || ""} ${entry.next_step || ""}`).includes(tooth));
  const visits = (data.visits || []).filter((visit) => visit.patient_id === patient.id && extractPlanTeeth(`${visit.teeth || ""} ${visit.diagnosis || ""} ${visit.procedure_description || ""}`).includes(tooth));
  const visitIds = new Set(visits.map((visit) => visit.id));
  const photos = (data.photos || []).filter((photo) => photo.patient_id === patient.id && ((photo.visit_id && visitIds.has(photo.visit_id)) || photoMentionsTooth(photo, tooth)));
  const latestVisit = visits.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const lastPlan = activePlan[activePlan.length - 1];
  const autoStatus = activePlan.some((item) => item.status === "В процессе")
    ? "В процессе"
    : activePlan.some((item) => item.status === "Запланировано")
      ? "Запланировано"
      : activePlan.some((item) => item.status === "Выполнено")
        ? "Выполнено"
        : "Здоров";
  const diagnoses = normalizeToothDiagnoses(record);
  const status = toothPrimaryStatus(record, autoStatus);
  const meta = toothStatusMeta(status);
  const displayTags = (diagnoses.length ? diagnoses : [status])
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 3);
  const attention = diagnoses.some(toothIsProblem) || toothIsProblem(status) || activePlan.some((item) => item.status !== "Выполнено") || diary.some((entry) => entry.type === "Риск");
  return {
    record,
    status,
    meta,
    diagnoses,
    displayTags,
    plan,
    activePlan,
    diary,
    visits,
    photos,
    latestVisit,
    lastPlan,
    attention,
    title: record.diagnosis || diagnoses.join(", ") || record.action || lastPlan?.name || latestVisit?.diagnosis || meta.label,
    subtitle: [
      activePlan.length ? `${activePlan.length} в плане` : "",
      visits.length ? `${visits.length} виз.` : "",
      diary.length ? `${diary.length} дневн.` : "",
      photos.length ? `${photos.length} фото` : ""
    ].filter(Boolean).join(" · ")
  };
}

function dentalOverview(patient, data = {}) {
  const contexts = toothRows.flatMap(([, teeth]) => teeth.map((tooth) => [tooth, toothClinicalContext(patient, data, tooth)]));
  return {
    contexts,
    problems: contexts.filter(([, context]) => toothIsProblem(context.status) || context.diagnoses.some(toothIsProblem)),
    planned: contexts.filter(([, context]) => context.activePlan.some((item) => item.status !== "Выполнено")),
    done: contexts.filter(([, context]) => context.status === "Выполнено"),
    missing: contexts.filter(([, context]) => context.status === "Удалён"),
    observed: contexts.filter(([, context]) => context.status === "Наблюдение")
  };
}

function DentalChart({ patient, data, onSelect }) {
  const overview = dentalOverview(patient, data);
  const quickList = [...overview.problems, ...overview.planned, ...overview.observed]
    .filter(([tooth], index, array) => array.findIndex(([candidate]) => candidate === tooth) === index)
    .slice(0, 8);
  return (
    <div className="section-block dental-chart-section">
      <div className="section-heading"><div><h2>Умная клиническая карта</h2><p>Зубная формула, план лечения, дневник, визиты и фото в одном месте</p></div></div>
      <div className="clinical-map-summary">
        <article className="summary-danger"><strong>{overview.problems.length}</strong><span>проблемных</span></article>
        <article className="summary-planned"><strong>{overview.planned.length}</strong><span>в плане</span></article>
        <article className="summary-done"><strong>{overview.done.length}</strong><span>выполнено</span></article>
        <article className="summary-muted"><strong>{overview.missing.length}</strong><span>удалено</span></article>
      </div>
      <div className="dental-chart card">
        {toothRows.map(([label, teeth]) => (
          <div className="jaw-row" key={label}>
            <span>{label}</span>
            <div>{teeth.map((number) => {
              const context = toothClinicalContext(patient, data, number);
              return (
                <button key={number} className={`tooth smart-tooth tooth-tone-${context.meta.tone} ${context.attention ? "attention" : ""}`} onClick={() => onSelect(number)} title={`Зуб ${number}: ${context.title}`}>
                  <strong>{number}</strong>
                  <span className="tooth-tags">
                    {(context.record.short ? [context.record.short] : context.displayTags.map((tag) => toothStatusMeta(tag).short)).map((tag, index) => (
                      <small key={`${tag}-${index}`}>{tag}</small>
                    ))}
                  </span>
                  {(context.activePlan.length > 0 || context.visits.length > 0 || context.photos.length > 0) && (
                    <span className="tooth-indicators">
                      {context.activePlan.length > 0 && <i>П</i>}
                      {context.visits.length > 0 && <i>В</i>}
                      {context.photos.length > 0 && <i>Ф</i>}
                    </span>
                  )}
                </button>
              );
            })}</div>
          </div>
        ))}
        <div className="tooth-legend">
          {toothStatusCatalog.filter((item) => item.value !== "Здоров").map((status) => <span key={status.value} className={`tooth-tone-${status.tone}`}>{status.label}</span>)}
        </div>
      </div>
      <div className="tooth-context-panel">
        <div className="section-heading compact"><div><h2>Активные клинические фокусы</h2><p>{quickList.length ? "Зубы, которые требуют внимания или уже находятся в плане" : "Проблемные зубы и незавершённые планы появятся здесь автоматически"}</p></div></div>
        {quickList.length ? (
          <div className="tooth-focus-grid">
            {quickList.map(([tooth, context]) => (
              <button className={`tooth-focus-card tooth-tone-${context.meta.tone}`} key={tooth} onClick={() => onSelect(tooth)}>
                <strong>{tooth}</strong>
                <span>{context.title}</span>
                <small>{context.subtitle || context.meta.label}</small>
              </button>
            ))}
          </div>
        ) : <Empty icon={<Stethoscope />} title="Карта спокойная" text="Добавьте диагноз, план лечения или запись дневника по конкретному зубу — карта сама соберёт клиническую сводку." />}
      </div>
    </div>
  );
}

function ToothEditor({ patient, tooth, data, clinicId, onClose, onSaved, onPhotoSaved }) {
  const existing = toothChart(patient)[tooth] || {};
  const [form, setForm] = useState({
    status: existing.status || "Здоров",
    diagnoses: normalizeToothDiagnoses(existing),
    diagnosis: existing.diagnosis || "",
    short: existing.short || "",
    action: existing.action || "",
    risk: existing.risk || "",
    prognosis: existing.prognosis || "",
    next_step: existing.next_step || "",
    note: existing.note || ""
  });
  const [busy, setBusy] = useState(false);
  const [photoUploader, setPhotoUploader] = useState(false);
  const context = toothClinicalContext(patient, data, tooth);
  const toggleDiagnosis = (value) => {
    setForm((current) => {
      const values = Array.isArray(current.diagnoses) ? current.diagnoses : [];
      return {
        ...current,
        diagnoses: values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
      };
    });
  };
  const canClear = form.status === "Здоров" && !form.diagnoses.length && !form.diagnosis.trim() && !form.short.trim() && !form.action.trim() && !form.risk.trim() && !form.prognosis.trim() && !form.next_step.trim() && !form.note.trim();
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const nextChart = { ...toothChart(patient) };
      if (canClear) delete nextChart[tooth];
      else {
        const primaryStatus = form.diagnoses.find(toothIsProblem) || form.diagnoses[0] || form.status || "Здоров";
        nextChart[tooth] = { ...form, status: primaryStatus, updated_at: new Date().toISOString() };
      }
      await savePatient(clinicId, { ...patient, dental: { ...(patient.dental || {}), tooth_chart: nextChart } });
      await onSaved();
    } catch (error) {
      alert(error.message || "Не удалось сохранить состояние зуба");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Клиническая карточка зуба ${tooth}`} onClose={onClose} large>
      <form onSubmit={save}>
        <div className={`tooth-editor-hero tooth-tone-${context.meta.tone}`}>
          <div><strong>{tooth}</strong><span>{context.title}</span><small>{context.subtitle || "Ручная клиническая карточка"}</small></div>
          <StatusBadge status={context.status} />
        </div>
        <div className="form-grid">
          <Field label="Состояние">
            <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              {toothStatusCatalog.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
          </Field>
          <Field label="Короткая метка">
              <input value={form.short} onChange={(event) => setForm((current) => ({ ...current, short: event.target.value }))} placeholder="Напр.: MOD, E-max, 2.6" />
            </Field>
          <Field label="Диагнозы / статусы зуба" full>
            <div className="tooth-diagnosis-picker">
              {toothDiagnosisOptions.map((item) => (
                <button type="button" key={item.value} className={`tooth-tone-${item.tone} ${form.diagnoses.includes(item.value) ? "selected" : ""}`} onClick={() => toggleDiagnosis(item.value)}>
                  <Check />{item.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Диагноз / находка" full><input value={form.diagnosis} onChange={(event) => setForm((current) => ({ ...current, diagnosis: event.target.value }))} placeholder="Например: кариес дентина, наблюдение, ранее лечен" /></Field>
          <Field label="Что делаем по зубу" full><textarea value={form.action} onChange={(event) => setForm((current) => ({ ...current, action: event.target.value }))} placeholder="Например: лечение кариеса MOD, эндо, временная реставрация, коронка, контроль через 3 месяца" /></Field>
          <Field label="Риск"><input value={form.risk} onChange={(event) => setForm((current) => ({ ...current, risk: event.target.value }))} placeholder="Скол, боль, перегрузка..." /></Field>
          <Field label="Прогноз"><select value={form.prognosis} onChange={(event) => setForm((current) => ({ ...current, prognosis: event.target.value }))}><option value="">Не указан</option>{["Благоприятный", "Осторожный", "Сомнительный", "Неблагоприятный"].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Следующее действие" full><textarea value={form.next_step} onChange={(event) => setForm((current) => ({ ...current, next_step: event.target.value }))} placeholder="Что сделать на следующем визите или что обсудить с пациентом" /></Field>
          <Field label="Комментарий врача" full><textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Материалы, наблюдения, нюансы, договорённости" /></Field>
        </div>
        <div className="tooth-linked-data">
          <InfoCard title="Связанные этапы плана" icon={<ClipboardList />}>
            {context.plan.length ? context.plan.map((item) => <InfoRow key={item.id} label={item.status || "План"} value={`${item.name} · ${money.format(item.price || 0)}`} />) : <p className="muted">Этапов по этому зубу пока нет.</p>}
          </InfoCard>
          <InfoCard title="Визиты и дневник" icon={<History />}>
            {context.visits.slice(0, 3).map((visit) => <InfoRow key={visit.id} label={safeDate(visit.date)} value={visit.diagnosis || visit.procedure_description || visit.treatment_type} />)}
            {context.diary.slice(0, 3).map((entry) => <InfoRow key={entry.id} label={entry.type} value={entry.title || entry.text} />)}
            {!context.visits.length && !context.diary.length && <p className="muted">Записей по этому зубу пока нет.</p>}
          </InfoCard>
        </div>
        <div className="tooth-photo-section">
          <div className="section-heading compact">
            <div><h2>Фото зуба</h2><p>{context.photos.length ? `${context.photos.length} фото привязано к зубу ${tooth}` : "Добавьте снимки, фото этапов или результат по этому зубу"}</p></div>
            <button type="button" className="primary" onClick={() => setPhotoUploader(true)}><Camera />Добавить фото</button>
          </div>
          {context.photos.length ? (
            <div className="tooth-photo-strip">
              {context.photos.slice(0, 8).map((photo) => (
                <a href={photo.signed_url} target="_blank" rel="noreferrer" className="tooth-photo-thumb" key={photo.id}>
                  <img src={photo.signed_url} alt={photo.category} />
                  <span>{photo.category}</span>
                </a>
              ))}
            </div>
          ) : (
            <button type="button" className="tooth-photo-empty" onClick={() => setPhotoUploader(true)}><Camera />Добавить первое фото зуба {tooth}</button>
          )}
        </div>
        <ModalActions busy={busy} onCancel={onClose} />
      </form>
      {photoUploader && (
        <PhotoUploader
          patient={patient}
          visits={(data.visits || []).filter((visit) => visit.patient_id === patient.id)}
          clinicId={clinicId}
          presetTooth={tooth}
          onClose={() => setPhotoUploader(false)}
          onSaved={async () => {
            setPhotoUploader(false);
            await onPhotoSaved?.();
          }}
        />
      )}
    </Modal>
  );
}

function PatientTimeline({ patient, data }) {
  const items = [
    ...data.visits.filter((visit) => visit.patient_id === patient.id).map((visit) => ({
      id: `visit-${visit.id}`, date: visit.date, icon: <Stethoscope />,
      title: visit.treatment_type, text: visit.procedure_description || visit.diagnosis || "Визит"
    })),
    ...data.transactions.filter((transaction) => transaction.patient_id === patient.id).map((transaction) => ({
      id: `tx-${transaction.id}`, date: transaction.date, icon: <WalletCards />,
      title: `${transaction.type}: ${money.format(transaction.amount)}`, text: transaction.category
    })),
    ...data.photos.filter((photo) => photo.patient_id === patient.id).map((photo) => ({
      id: `photo-${photo.id}`, date: photo.created_at, icon: <Camera />,
      title: "Добавлена фотография", text: photo.category
    })),
    ...treatmentItems(patient).map((item) => ({
      id: `plan-${item.id}`, date: item.updated_at || item.created_at || patient.updated_at, icon: <ClipboardList />,
      title: `План: ${item.name}`, text: `${item.status || "Запланировано"} · ${money.format(item.price || 0)}`
    })),
    ...diaryEntries(patient).map((entry) => ({
      id: `diary-${entry.id}`, date: entry.date || entry.updated_at, icon: <History />,
      title: `Дневник: ${entry.title}`, text: [entry.type, entry.teeth && `FDI ${entry.teeth}`, entry.next_step && `Дальше: ${entry.next_step}`].filter(Boolean).join(" · ") || entry.text
    }))
  ].filter((item) => item.date).sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="section-block">
      <div className="section-heading"><div><h2>История пациента</h2><p>Все события в одном месте</p></div></div>
      {items.length ? <div className="timeline">{items.map((item) => (
        <div className="timeline-item" key={item.id}>
          <div className="timeline-icon">{item.icon}</div>
          <div><time>{safeDate(item.date)}{String(item.date).includes("T") ? ` · ${timeLabel(item.date)}` : ""}</time><strong>{item.title}</strong><p>{item.text}</p></div>
        </div>
      ))}</div> : <Empty icon={<History />} title="История пока пуста" text="Визиты, фотографии, оплаты и планы лечения появятся здесь автоматически." />}
    </div>
  );
}

function RecommendationsSection({ patient, clinic, visits, clinicId, refresh, notify }) {
  const [text, setText] = useState(patient.dental?.recommendations || visits[0]?.recommendations || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await savePatient(clinicId, {
        ...patient,
        dental: { ...(patient.dental || {}), recommendations: text }
      });
      await refresh();
      notify("Рекомендации сохранены");
    } catch (error) {
      alert(error.message || "Не удалось сохранить рекомендации");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="section-block">
      <div className="section-heading">
        <div><h2>Рекомендации пациенту</h2><p>Заполните один раз, затем распечатайте или сохраните как PDF</p></div>
        <button className="secondary" onClick={() => printPatientDocument("recommendations", { ...patient, dental: { ...(patient.dental || {}), recommendations: text } }, clinic, treatmentItems(patient), visits[0])}><Printer />Печать / PDF</button>
      </div>
      <article className="info-card recommendations-editor">
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={"Например:\n• Не принимать пищу в течение 2 часов.\n• Исключить горячее и твёрдое в первые сутки.\n• При появлении боли связаться с клиникой."} />
        <div>
          <span>{text.length} символов</span>
          <button className="primary" disabled={busy} onClick={save}>{busy ? "Сохранение…" : "Сохранить рекомендации"}</button>
        </div>
      </article>
    </div>
  );
}

function DocumentsSection({ patient, clinic, visits, documents, clinicId, onUpload, refresh, notify }) {
  const plan = treatmentItems(patient);
  const latest = visits[0];
  const [previewDocument, setPreviewDocument] = useState(null);
  const documentFlags = patient.dental?.document_flags || {};
  const consentPrintedAt = documentFlags.consent_printed_at;
  const print = (type) => printPatientDocument(type, patient, clinic, plan, latest);
  const downloadGenerated = async (type) => {
    try {
      await downloadPatientDocument(type, patient, clinic, plan, latest);
    } catch (error) {
      alert(error.message || "Не удалось сформировать PDF");
    }
  };
  const setConsentPrinted = async (printed) => {
    try {
      await savePatient(clinicId, {
        ...patient,
        dental: {
          ...(patient.dental || {}),
          document_flags: {
            ...documentFlags,
            consent_printed_at: printed ? new Date().toISOString() : ""
          }
        }
      });
      await refresh();
      notify(printed ? "Согласие отмечено как распечатанное" : "Отметка согласия снята");
    } catch (error) {
      alert(error.message || "Не удалось обновить статус согласия");
    }
  };
  const printConsent = async () => {
    const opened = print("consent");
    if (opened !== false && !consentPrintedAt) await setConsentPrinted(true);
  };
  const remove = async (document) => {
    if (!confirm(`Удалить файл «${document.file_name}»?`)) return;
    await deleteDocument(document);
    await refresh();
    notify("Документ удалён");
  };
  const download = async (document) => {
    try {
      const response = await fetch(document.signed_url);
      if (!response.ok) throw new Error("Файл недоступен");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.file_name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message || "Не удалось скачать документ");
    }
  };
  return (
    <div className="section-block">
      <div className="section-heading">
        <div><h2>Документы пациента</h2><p>Печать или сохранение через «Сохранить как PDF»</p></div>
        <button className="primary" onClick={onUpload}><Upload />Добавить файл</button>
      </div>
      <div className="documents-grid">
        <article className="document-card">
          <div><ClipboardList /><span><strong>План лечения</strong><small>{plan.length} этапов · {money.format(sum(plan, (item) => item.price))}</small></span></div>
          <p>Документ в виде этапов лечения, зубной схемы, цен и итоговой суммы.</p>
          <div className="document-card-actions">
            <button className="primary" onClick={() => downloadGenerated("plan")}><Download />Скачать PDF</button>
            <button className="secondary" onClick={() => print("plan")}><Printer />Печать</button>
          </div>
        </article>
        <article className="document-card">
          <div><FileCheck2 /><span><strong>Рекомендации</strong><small>Для выдачи пациенту</small></span></div>
          <p>Текущие рекомендации из карточки и последнего визита.</p>
          <button className="primary" onClick={() => print("recommendations")}><Printer />Печать / PDF</button>
        </article>
        <article className="document-card">
          <div><ShieldCheck /><span><strong>Согласие пациента</strong><small>{consentPrintedAt ? `Распечатано ${safeDate(consentPrintedAt)}` : "Шаблон для подписи"}</small></span></div>
          <p>Информированное согласие с местами для даты и подписей.</p>
          <div className="document-card-actions">
            <button className="primary" onClick={printConsent}><Printer />Печать / PDF</button>
            <button className="secondary" onClick={() => setConsentPrinted(!consentPrintedAt)}>
              <Check />{consentPrintedAt ? "Снять отметку" : "Отметить"}
            </button>
          </div>
        </article>
      </div>
      <div className={`document-status-note ${consentPrintedAt ? "ready" : ""}`}>
        <ShieldCheck />
        <span>{consentPrintedAt ? `Согласие пациента уже печаталось: ${safeDate(consentPrintedAt)}.` : "Согласие пациента ещё не отмечено как распечатанное."}</span>
      </div>
      <div className="document-notice"><AlertTriangle />Текст согласия является базовым шаблоном. Перед использованием проверьте его с юристом по требованиям вашей страны.</div>
      <div className="section-heading uploaded-documents-heading"><div><h2>Загруженные файлы</h2><p>{documents.length} файлов</p></div></div>
      {documents.length ? (
        <div className="uploaded-documents">
          {documents.map((document) => (
            <article className="uploaded-document" key={document.id}>
              <div className="file-type">{fileExtension(document.file_name)}</div>
              <div>
                <strong>{document.file_name}</strong>
                <span>{document.category} · {formatFileSize(document.file_size)} · {safeDate(document.created_at)}</span>
                {document.comment && <p>{document.comment}</p>}
              </div>
              <div className="document-actions">
                <button className="secondary" onClick={() => setPreviewDocument(document)}><FileText />Открыть</button>
                <button className="secondary" onClick={() => download(document)}><Download />Скачать</button>
              </div>
              <button className="icon-button mini danger-ghost" onClick={() => remove(document)}><Trash2 /></button>
            </article>
          ))}
        </div>
      ) : <Empty icon={<FileText />} title="Своих файлов пока нет" text="Добавьте согласие, PDF, Word, Excel, презентацию, снимок или другой документ пациента." action={onUpload} />}
      {previewDocument && <DocumentPreview document={previewDocument} onClose={() => setPreviewDocument(null)} onDownload={() => download(previewDocument)} />}
    </div>
  );
}

function DocumentPreview({ document, onClose, onDownload }) {
  return (
    <div className="document-preview-backdrop">
      <section className="document-preview-panel">
        <header>
          <button className="secondary" onClick={onClose}><ChevronLeft />Закрыть</button>
          <div>
            <strong>{document.file_name}</strong>
            <span>{document.category} · {formatFileSize(document.file_size)}</span>
          </div>
          <button className="secondary" onClick={onDownload}><Download />Скачать</button>
        </header>
        <iframe title={document.file_name} src={document.signed_url} />
        <footer>
          <span>Если формат не отображается в предпросмотре, скачайте файл или откройте его в отдельном приложении.</span>
          <a className="secondary" href={document.signed_url} target="_blank" rel="noreferrer">Открыть отдельно</a>
        </footer>
      </section>
    </div>
  );
}

function extractPlanTeeth(value = "") {
  return [...String(value).matchAll(/\b(?:1[1-8]|2[1-8]|3[1-8]|4[1-8])\b/g)].map((match) => match[0]);
}

function treatmentQuantity(item) {
  return Math.max(1, extractPlanTeeth(item.teeth).length || Number(item.quantity || 1));
}

function treatmentUnitPrice(item) {
  const quantity = treatmentQuantity(item);
  return Math.round(Number(item.price || 0) / quantity);
}

const planToothRows = [
  ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"],
  ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"]
];

const compactMoney = (value) => money.format(value || 0).replace(/\s?₽/, "");
const safeFileName = (value = "document") => String(value).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

function activeTreatmentPlan(plan) {
  return plan.filter((item) => item.status !== "Отменено");
}

function planToothSet(plan) {
  return new Set(plan.flatMap((item) => extractPlanTeeth(`${item.teeth || ""} ${item.notes || ""}`)));
}

function renderPdfToothSchemeSvg(plan) {
  const selected = planToothSet(plan);
  const toothWidth = 34;
  const step = 45;
  const startX = 18;
  const rowStartY = [16, 86];
  const width = 760;
  const height = 154;
  const teeth = planToothRows.map((row, rowIndex) => row.map((number, index) => {
    const x = startX + index * step;
    const y = rowStartY[rowIndex];
    const active = selected.has(number);
    const border = active ? "#D84F45" : "#1F2933";
    const marker = active
      ? `<ellipse cx="${x + 17}" cy="${y + 40}" rx="11" ry="8" fill="#E86B5D" opacity="0.88"/>
         <path d="M${x + 6} ${y + 61}H${x + 28}" stroke="#E86B5D" stroke-width="4" stroke-linecap="round"/>`
      : "";
    return `
      <g>
        <text x="${x + 17}" y="${y}" text-anchor="middle" font-family="Roboto, Arial" font-size="13" font-weight="700" fill="#111827">${number}</text>
        <path d="M${x + 17} ${y + 9}
          C${x + 7} ${y + 9} ${x + 4} ${y + 20} ${x + 7} ${y + 32}
          C${x + 9} ${y + 43} ${x + 11} ${y + 58} ${x + 17} ${y + 62}
          C${x + 23} ${y + 58} ${x + 25} ${y + 43} ${x + 27} ${y + 32}
          C${x + 30} ${y + 20} ${x + 27} ${y + 9} ${x + 17} ${y + 9}Z"
          fill="#FFFFFF" stroke="${border}" stroke-width="${active ? 2.8 : 2}" />
        ${marker}
      </g>`;
  }).join("")).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" rx="18" fill="#FBFAF7"/>
    ${teeth}
  </svg>`;
}

function treatmentPlanPdfDefinition(patient, clinic, plan) {
  const activePlan = activeTreatmentPlan(plan);
  const total = sum(activePlan, (item) => item.price);
  const patientName = patient.full_name || "Пациент";
  const birthDate = patient.birth_date ? safeDate(patient.birth_date) : "не указана";
  const generated = new Date().toLocaleDateString("ru-RU");
  const clinicName = clinic?.name || "CURE CLINIC";
  const selectedTeeth = [...planToothSet(activePlan)].sort((a, b) => Number(a) - Number(b));
  const stages = activePlan.length ? activePlan.flatMap((item, index) => {
    const quantity = treatmentQuantity(item);
    const unitPrice = treatmentUnitPrice(item);
    const teeth = extractPlanTeeth(item.teeth).join(", ") || item.teeth || "—";
    const serviceText = [
      item.name,
      teeth !== "—" ? `Зуб / область: ${teeth}` : "",
      item.notes || ""
    ].filter(Boolean).join("\n");
    return [
      {
        columns: [
          { text: `${index + 1} Этап`, style: "stageTitle" },
          { text: compactMoney(item.price || 0), style: "stageTotal" }
        ],
        margin: [0, index ? 12 : 0, 0, 4]
      },
      {
        table: {
          widths: [24, "*", 74, 44, 74],
          body: [
            [
              { text: "№", style: "tableHead" },
              { text: "Услуга", style: "tableHead" },
              { text: "Цена за ед.", style: "tableHead", alignment: "right" },
              { text: "Кол-во", style: "tableHead", alignment: "right" },
              { text: "Всего", style: "tableHead", alignment: "right" }
            ],
            [
              { text: "1", style: "cell" },
              { text: serviceText, style: "serviceCell" },
              { text: compactMoney(unitPrice), style: "cell", alignment: "right" },
              { text: String(quantity), style: "cell", alignment: "right" },
              { text: compactMoney(item.price || 0), style: "cell", alignment: "right" }
            ]
          ]
        },
        layout: {
          hLineWidth: (line) => line === 1 ? 0.6 : 0,
          vLineWidth: () => 0,
          hLineColor: () => "#DED7C7",
          paddingLeft: () => 0,
          paddingRight: () => 6,
          paddingTop: () => 3,
          paddingBottom: () => 3
        }
      }
    ];
  }) : [{ text: "План лечения пока не заполнен.", margin: [0, 12, 0, 0] }];

  return {
    pageSize: "A4",
    pageMargins: [36, 30, 36, 30],
    defaultStyle: { font: "Roboto", fontSize: 10.2, lineHeight: 1.22, color: "#171717" },
    content: [
      {
        columns: [
          { stack: [{ text: "CURE", style: "brand" }, { text: "CLINIC", style: "brandSub" }], width: 120 },
          { text: clinicName, alignment: "right", color: "#6F6A5D", margin: [0, 8, 0, 0] }
        ],
        margin: [0, 0, 0, 12]
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.8, lineColor: "#D8CFBA" }], margin: [0, 0, 0, 12] },
      {
        table: {
          widths: ["*"],
          body: [[
            {
              text: [
                { text: "Пациент: ", bold: true }, `${patientName}\n`,
                { text: "Дата рождения: ", bold: true }, `${birthDate}\n`,
                { text: "Дата документа: ", bold: true }, generated
              ],
              margin: [9, 7, 9, 7]
            }
          ]]
        },
        layout: {
          fillColor: () => "#FBFAF7",
          hLineColor: () => "#E4DDCF",
          vLineColor: () => "#E4DDCF",
          hLineWidth: () => 0.8,
          vLineWidth: () => 0.8
        },
        margin: [0, 0, 0, 14]
      },
      { text: "План лечения", style: "title" },
      { text: `Диагноз: ${patient.dental?.diagnosis || "не указан"}`, margin: [0, 0, 0, 8] },
      { text: "Представляем вашему вниманию план лечения ваших зубов:", style: "intro" },
      { svg: renderPdfToothSchemeSvg(activePlan), width: 510, alignment: "center", margin: [0, 4, 0, 4] },
      {
        columns: [
          { canvas: [{ type: "ellipse", x: 7, y: 7, r1: 6, r2: 6, color: "#E86B5D" }], width: 18 },
          { text: selectedTeeth.length ? `Отмечены зубы из плана лечения: ${selectedTeeth.join(", ")}` : "Зубы в плане пока не указаны.", color: "#5F5A50" }
        ],
        columnGap: 5,
        margin: [0, 0, 0, 12]
      },
      ...stages,
      {
        columns: [
          { text: "ИТОГО ПО ПРАЙСУ:", style: "grandTotalLabel" },
          { text: money.format(total), style: "grandTotalValue" }
        ],
        margin: [0, 16, 0, 0]
      },
      {
        columns: [
          { text: "Врач ____________________", fontSize: 9 },
          { text: "Пациент ____________________", fontSize: 9, alignment: "right" }
        ],
        margin: [0, 30, 0, 0]
      }
    ],
    styles: {
      brand: { fontSize: 26, color: "#A88C45", characterSpacing: 4, bold: true },
      brandSub: { fontSize: 7, color: "#A88C45", characterSpacing: 3, margin: [18, -4, 0, 0] },
      title: { fontSize: 24, bold: true, margin: [0, 0, 0, 7] },
      intro: { fontSize: 11, bold: true, margin: [0, 0, 0, 6] },
      stageTitle: { fontSize: 14, bold: true },
      stageTotal: { fontSize: 14, bold: true, alignment: "right" },
      tableHead: { fontSize: 8.5, bold: true, color: "#111111" },
      cell: { fontSize: 9.5 },
      serviceCell: { fontSize: 9.5, bold: true },
      grandTotalLabel: { fontSize: 15, bold: true },
      grandTotalValue: { fontSize: 15, bold: true, alignment: "right" }
    }
  };
}

async function downloadPatientDocument(type, patient, clinic, plan, latestVisit) {
  if (type !== "plan") {
    return printPatientDocument(type, patient, clinic, plan, latestVisit);
  }
  const fileName = safeFileName(`План лечения - ${patient.full_name || "пациент"}`) || "План лечения";
  pdfMake.createPdf(treatmentPlanPdfDefinition(patient, clinic, plan)).download(`${fileName}.pdf`);
  return true;
}

function renderPlanToothScheme(plan) {
  const selected = planToothSet(plan);
  return `<div class="pdf-tooth-chart">${planToothRows.map((row) => `
    <div class="pdf-teeth-row">
      ${row.map((number) => `<span class="pdf-tooth ${selected.has(number) ? "selected" : ""}"><i>${number}</i><b></b></span>`).join("")}
    </div>
  `).join("")}</div>`;
}

function renderTreatmentPlanPdf(patient, plan) {
  const activePlan = activeTreatmentPlan(plan);
  const total = sum(activePlan, (item) => item.price);
  const stages = activePlan.length ? activePlan.map((item, index) => {
    const quantity = treatmentQuantity(item);
    const unitPrice = treatmentUnitPrice(item);
    const teeth = item.teeth ? `<br><small>${escapeHtml(item.teeth)}</small>` : "";
    const note = item.notes ? `<em>${escapeHtml(item.notes)}</em>` : "";
    return `
      <section class="plan-stage">
        <div class="stage-title"><h2>${index + 1} Этап</h2><strong>${compactMoney(item.price || 0)}</strong></div>
        <table class="plan-stage-table">
          <thead><tr><th>№</th><th>Услуга</th><th>Цена за ед.</th><th>Кол-во</th><th>Всего</th></tr></thead>
          <tbody>
            <tr>
              <td>1</td>
              <td><b>${escapeHtml(item.name)}</b>${teeth}${note}</td>
              <td>${compactMoney(unitPrice)}</td>
              <td>${quantity}</td>
              <td>${compactMoney(item.price || 0)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    `;
  }).join("") : `<section class="plan-stage"><p>План лечения пока не заполнен.</p></section>`;

  return `
    <div class="plan-document">
      <h1>Представляем Вашему вниманию план лечения ваших зубов:</h1>
      ${renderPlanToothScheme(activePlan)}
      <div class="plan-stages">${stages}</div>
      <div class="plan-grand-total">ИТОГО ПО ПРАЙСУ: <b>${money.format(total)}</b></div>
      <div class="signatures compact"><span>Врач ____________________</span><span>Пациент ____________________</span></div>
    </div>
  `;
}

function printPatientDocument(type, patient, clinic, plan, latestVisit) {
  const popup = window.open("", "_blank", "width=900,height=1100");
  if (!popup) {
    alert("Разрешите всплывающие окна, чтобы открыть документ");
    return false;
  }
  const clinicName = escapeHtml(clinic?.name || "CURE CLINIC");
  const patientName = escapeHtml(patient.full_name);
  const birthDate = patient.birth_date ? safeDate(patient.birth_date) : "не указана";
  const generated = new Date().toLocaleDateString("ru-RU");
  const sharedHeader = `
    <header><div class="brand">CURE <small>CLINIC</small></div><div>${clinicName}</div></header>
    <div class="patient"><b>Пациент:</b> ${patientName}<br><b>Дата рождения:</b> ${birthDate}<br><b>Дата документа:</b> ${generated}</div>
  `;
  const documents = {
    plan: {
      title: "План лечения",
      body: `${sharedHeader}
        <h1 class="document-main-title">План лечения</h1>
        <p><b>Диагноз:</b> ${escapeHtml(patient.dental?.diagnosis || "не указан")}</p>
        ${renderTreatmentPlanPdf(patient, plan)}`
    },
    recommendations: {
      title: "Рекомендации",
      body: `${sharedHeader}
        <h1>Рекомендации пациенту</h1>
        <div class="text">${escapeHtml(patient.dental?.recommendations || latestVisit?.recommendations || "Индивидуальные рекомендации пока не заполнены.").replaceAll("\n", "<br>")}</div>
        ${latestVisit ? `<p><b>Последний визит:</b> ${safeDate(latestVisit.date)} · ${escapeHtml(latestVisit.treatment_type)}</p>` : ""}
        <div class="signatures"><span>Врач ____________________</span><span>Пациент ____________________</span></div>`
    },
    consent: {
      title: "Информированное согласие",
      body: `${sharedHeader}
        <h1>Информированное добровольное согласие</h1>
        <div class="text consent">
          Я, ${patientName}, подтверждаю, что получил(а) понятную информацию о состоянии здоровья, предполагаемых методах обследования и лечения, возможных альтернативах, рисках, осложнениях и ожидаемых результатах.
          <br><br>Мне была предоставлена возможность задать вопросы и получить на них ответы. Я сообщил(а) врачу известные мне сведения об аллергиях, заболеваниях и принимаемых препаратах.
          <br><br><b>Планируемое вмешательство / лечение:</b><br><br>____________________________________________________________________<br><br>____________________________________________________________________
          <br><br>Я понимаю, что результат медицинского вмешательства не может быть гарантирован, и добровольно соглашаюсь на указанное лечение.
        </div>
        <div class="signatures"><span>Пациент ____________________</span><span>Врач ____________________</span><span>Дата ____________________</span></div>`
    }
  };
  const document = documents[type];
  popup.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${document.title} — ${patientName}</title>
    <style>
      @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#1c1c1e;background:#111;font:14px/1.55 Arial,sans-serif}
      .pdf-toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;color:#fff;background:#000}
      .pdf-toolbar button{min-height:38px;padding:8px 12px;color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:12px;background:transparent;font-weight:700}
      .pdf-toolbar strong{font-size:15px}.pdf-toolbar span{color:rgba(255,255,255,.68);font-size:12px}
      .pdf-page{width:min(920px,100%);min-height:100vh;margin:0 auto;padding:18px;background:white}
      header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:1px solid #d9d4c8;color:#6e6e73}
      .brand{color:#a88c45;font:28px Georgia,serif;letter-spacing:.12em}.brand small{display:block;text-align:center;font:7px Arial,sans-serif;letter-spacing:.35em}
      .patient{margin:18px 0;padding:13px;border:1px solid #e6e1d6;border-radius:10px;background:#f8f7f3}
      h1{margin:22px 0 16px;font:30px Georgia,serif}.document-main-title{margin-bottom:10px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:10px;border-bottom:1px solid #e6e1d6;text-align:left}th{color:#6e6e73;font-size:11px;text-transform:uppercase}
      td:last-child,th:last-child{text-align:right}.total{display:flex;justify-content:space-between;padding:18px 10px;border-top:2px solid #a88c45;font-size:17px}
      .text{min-height:260px;padding:20px;border:1px solid #e6e1d6;border-radius:10px;white-space:normal}.consent{min-height:420px}
      .signatures{display:flex;flex-wrap:wrap;justify-content:space-between;gap:28px;margin-top:70px}.signatures span{min-width:210px}
      .plan-document>h1{margin:10px 0 18px;font:700 18px/1.35 Arial,sans-serif;text-align:left}.pdf-tooth-chart{margin:14px auto 34px;max-width:650px}
      .pdf-teeth-row{display:flex;justify-content:center;gap:7px;margin:9px 0}.pdf-tooth{position:relative;width:30px;text-align:center;color:#111;font-size:11px;font-weight:700}.pdf-tooth i{display:block;font-style:normal;margin-bottom:3px}
      .pdf-tooth b{display:block;height:45px;border:2px solid #202020;border-radius:48% 48% 42% 42% / 35% 35% 65% 65%;background:white}.pdf-teeth-row:nth-child(2) .pdf-tooth b{border-radius:42% 42% 48% 48% / 65% 65% 35% 35%}
      .pdf-tooth.selected b{border-color:#d84f45}.pdf-tooth.selected::after{content:"";position:absolute;left:8px;right:8px;bottom:8px;height:12px;border-radius:99px;background:#e86b5d;box-shadow:0 0 0 2px rgba(232,107,93,.18)}.pdf-tooth.selected:nth-child(3n)::after{height:17px;bottom:12px}.pdf-tooth.selected:nth-child(4n)::after{left:5px;right:5px}
      .plan-stages{display:grid;grid-template-columns:1fr;gap:20px}.plan-stage{break-inside:avoid;page-break-inside:avoid}.stage-title{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:8px}.stage-title h2{margin:0;font:700 21px Arial,sans-serif}.stage-title strong{font:700 21px Arial,sans-serif}
      .plan-stage-table{margin:0}.plan-stage-table th{padding:4px 7px;color:#111;font:700 12px Arial,sans-serif;text-transform:none}.plan-stage-table td{vertical-align:top;padding:4px 7px;border:0;font-size:13px}.plan-stage-table td:nth-child(3),.plan-stage-table td:nth-child(4),.plan-stage-table td:nth-child(5){text-align:right;white-space:nowrap}.plan-stage-table small{color:#111}.plan-stage-table em{display:block;margin-top:3px;color:#555;font-style:normal}
      .plan-grand-total{margin-top:28px;padding-top:8px;border-top:0;font:800 20px Arial,sans-serif}.signatures.compact{margin-top:34px}.signatures.compact span{font-size:12px}
      @media(max-width:700px){.pdf-page{padding:12px}.pdf-toolbar{padding:10px}.pdf-toolbar strong{font-size:13px}.pdf-tooth{width:22px;font-size:9px}.pdf-tooth b{height:34px}.pdf-teeth-row{gap:4px}.stage-title h2,.stage-title strong{font-size:17px}.plan-stage-table th,.plan-stage-table td{font-size:10px;padding:3px 4px}}
      @media print{body{background:white}.pdf-toolbar{display:none}.pdf-page{width:auto;min-height:auto;margin:0;padding:0}button{display:none}}
    </style></head><body><div class="pdf-toolbar"><button onclick="window.close();setTimeout(()=>{if(!window.closed)history.back()},80)">← Закрыть</button><div><strong>${document.title}</strong><br><span>${patientName}</span></div><button onclick="window.print()">Печать</button></div><main class="pdf-page">${document.body}</main></body></html>`);
  popup.document.close();
  return true;
}

function CommunicationSection({ patient, clinicId, refresh, notify, onEdit, onCopy }) {
  const communication = communicationProfile(patient);
  const telegram = normalizeTelegramUsername(communication.telegram_username);
  const representative = communication.representative || {};
  const logs = Array.isArray(communication.logs) ? communication.logs : [];
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const telegramUrl = telegramLink(telegram);
  const whatsappUrl = whatsappLink(patient.phone);
  const representativeTelegramUrl = telegramLink(representative.telegram);
  const representativeWhatsappUrl = whatsappLink(representative.phone);

  const saveCommunication = async (nextCommunication, message) => {
    setBusy(true);
    try {
      await savePatient(clinicId, {
        ...patient,
        dental: {
          ...(patient.dental || {}),
          communication: nextCommunication
        }
      });
      await refresh();
      notify(message);
    } catch (error) {
      notify(error.message || "Не удалось сохранить связь");
    } finally {
      setBusy(false);
    }
  };

  const addLog = async (event) => {
    event.preventDefault();
    const text = entry.trim();
    if (!text) return;
    await saveCommunication({
      ...communication,
      logs: [
        { id: uuid(), date: new Date().toISOString(), text },
        ...logs
      ].slice(0, 40)
    }, "Запись связи добавлена");
    setEntry("");
  };

  const resolveFollowUp = async () => {
    await saveCommunication({
      ...communication,
      follow_up_needed: false,
      follow_up_reason: "",
      next_contact_date: ""
    }, "Задача связи закрыта");
  };

  return (
    <div className="section-block communication-section">
      <div className="section-heading">
        <div>
          <h2>Связь с пациентом</h2>
          <p>Контакты, Telegram, представитель и короткий журнал коммуникации.</p>
        </div>
        <button className="secondary" onClick={onEdit}><Edit3 />Редактировать</button>
      </div>

      <div className="communication-grid">
        <article className="info-card communication-card">
          <header><Send /><h3>Быстрая связь</h3></header>
          <div className="contact-stack">
            <div className="contact-line">
              <span>Телефон</span>
              <strong>{patient.phone || "Не указан"}</strong>
            </div>
            <div className="contact-line">
              <span>Telegram</span>
              <strong>{telegram ? `@${telegram}` : "Не указан"}</strong>
            </div>
            <div className="contact-actions">
              {patient.phone && <a className="secondary" href={`tel:${patient.phone}`}><Phone />Позвонить</a>}
              {telegramUrl && <a className="primary" href={telegramUrl} target="_blank" rel="noreferrer"><Send />Telegram</a>}
              {whatsappUrl && <a className="secondary" href={whatsappUrl} target="_blank" rel="noreferrer"><MessageCircle />WhatsApp</a>}
              {telegram && <button className="secondary" onClick={() => onCopy(`@${telegram}`, "Telegram скопирован")}><Copy />Скопировать</button>}
            </div>
          </div>
        </article>

        <article className="info-card communication-card">
          <header><UserPlus /><h3>Правила связи</h3></header>
          <div>
            <InfoRow label="Предпочтительный канал" value={communication.preferred_channel || "—"} />
            <InfoRow label="Комментарий" value={communication.contact_note || "—"} />
            <InfoRow label="Сообщения разрешены" value={communication.messaging_allowed ? "Да" : "Не указано"} />
            <InfoRow label="Следующий контакт" value={communication.next_contact_date ? safeDate(communication.next_contact_date) : "—"} />
          </div>
          {communication.important_note && (
            <div className="communication-note important-note">
              <AlertTriangle />
              <span>{communication.important_note}</span>
            </div>
          )}
        </article>

        <article className="info-card communication-card">
          <header><UserRound /><h3>Представитель</h3></header>
          <div>
            <InfoRow label="ФИО" value={representative.name || "—"} />
            <InfoRow label="Кем приходится" value={representative.relation || "—"} />
            <InfoRow label="Телефон" value={representative.phone || "—"} />
            <InfoRow label="Telegram" value={representative.telegram ? `@${normalizeTelegramUsername(representative.telegram)}` : "—"} />
          </div>
          {(representativeTelegramUrl || representativeWhatsappUrl) && (
            <div className="contact-actions compact-actions">
              {representativeTelegramUrl && <a className="secondary" href={representativeTelegramUrl} target="_blank" rel="noreferrer"><Send />Telegram</a>}
              {representativeWhatsappUrl && <a className="secondary" href={representativeWhatsappUrl} target="_blank" rel="noreferrer"><MessageCircle />WhatsApp</a>}
            </div>
          )}
        </article>

        <article className="info-card communication-card">
          <header><MessageCircle /><h3>Задача связи</h3></header>
          {communication.follow_up_needed ? (
            <div className="follow-up-box">
              <strong>{communication.follow_up_reason || "Нужно связаться с пациентом"}</strong>
              <span>{communication.next_contact_date ? `До ${safeDate(communication.next_contact_date)}` : "Дата не указана"}</span>
              <button className="primary" disabled={busy} onClick={resolveFollowUp}><Check />Закрыть задачу</button>
            </div>
          ) : (
            <div className="communication-empty">
              <Check />
              <span>Активной задачи связи нет</span>
            </div>
          )}
        </article>
      </div>

      <article className="info-card communication-log-card">
        <header><History /><h3>Журнал коммуникации</h3></header>
        <form className="communication-log-form" onSubmit={addLog}>
          <textarea value={entry} onChange={(event) => setEntry(event.target.value)} placeholder="Например: написал в Telegram, пациент подтвердил визит на пятницу." />
          <button className="primary" disabled={busy || !entry.trim()}><Plus />Добавить запись</button>
        </form>
        {logs.length ? (
          <div className="communication-log">
            {logs.map((item) => (
              <div className="communication-log-item" key={item.id}>
                <time>{safeDate(item.date)} · {timeLabel(item.date)}</time>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="communication-empty">
            <History />
            <span>Записей пока нет. Здесь можно фиксировать звонки, Telegram и договорённости.</span>
          </div>
        )}
      </article>
    </div>
  );
}

function PatientDiary({ patient, clinicId, refresh, notify }) {
  const [editor, setEditor] = useState(null);
  const entries = diaryEntries(patient).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const latest = entries[0];

  return (
    <div className="section-block diary-section">
      <div className="section-heading">
        <div>
          <h2>Дневник пациента</h2>
          <p>Динамика лечения, выполненные этапы и планы на следующие визиты.</p>
        </div>
        <button className="primary" onClick={() => setEditor({})}><Plus />Добавить запись</button>
      </div>

      {latest && (
        <article className="diary-latest card">
          <div>
            <span>{latest.type || "Запись"} · {safeDate(latest.date)}</span>
            <h3>{latest.title}</h3>
            <p>{latest.text}</p>
          </div>
          {latest.next_step && <small>Следующий шаг: {latest.next_step}</small>}
        </article>
      )}

      <div className="diary-template-row">
        <span><Sparkles />Быстрые шаблоны</span>
        <div>{diaryTemplates.map((template) => (
          <button key={template.title} onClick={() => setEditor(template)}>{template.type}</button>
        ))}</div>
      </div>

      {entries.length ? (
        <div className="diary-list">
          {entries.map((entry) => (
            <button className="diary-card" key={entry.id} onClick={() => setEditor(entry)}>
              <span>{safeDate(entry.date)} · {entry.type || "Запись"}</span>
              <strong>{entry.title}</strong>
              <p>{entry.text}</p>
              {entry.next_step && <small>Дальше: {entry.next_step}</small>}
            </button>
          ))}
        </div>
      ) : (
        <Empty icon={<History />} title="Дневник пока пуст" text="Добавьте первую запись: что сделали, как меняется состояние и что планируется дальше." action={() => setEditor({})} />
      )}

      {editor && (
        <DiaryEntryEditor
          patient={patient}
          entry={editor.id ? editor : null}
          template={!editor.id ? editor : null}
          clinicId={clinicId}
          onClose={() => setEditor(null)}
          onSaved={async (message) => { await refresh(); setEditor(null); notify(message); }}
        />
      )}
    </div>
  );
}

function DiaryEntryEditor({ patient, entry, template, clinicId, onClose, onSaved }) {
  const [form, setForm] = useState(entry ? structuredClone(entry) : {
    date: new Date().toISOString().slice(0, 16),
    type: template?.type || "Выполнено",
    title: template?.title || "",
    teeth: "",
    text: template?.text || "",
    next_step: template?.next_step || ""
  });
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const persist = async (nextEntries, message) => {
    setBusy(true);
    try {
      await savePatient(clinicId, {
        ...patient,
        dental: { ...(patient.dental || {}), diary_entries: nextEntries }
      });
      await onSaved(message);
    } catch (error) {
      alert(error.message || "Не удалось сохранить дневник");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) return alert("Напишите заголовок записи");
    if (!form.text.trim()) return alert("Заполните описание дневника");
    const nextEntry = {
      ...form,
      id: entry?.id || uuid(),
      created_at: entry?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      title: form.title.trim(),
      teeth: form.teeth.trim(),
      text: form.text.trim(),
      next_step: form.next_step.trim()
    };
    const currentEntries = diaryEntries(patient);
    const nextEntries = entry
      ? currentEntries.map((item) => item.id === entry.id ? nextEntry : item)
      : [nextEntry, ...currentEntries];
    await persist(nextEntries, entry ? "Запись дневника обновлена" : "Запись дневника добавлена");
  };

  const remove = async () => {
    if (!entry || !confirm("Удалить запись из дневника пациента?")) return;
    await persist(diaryEntries(patient).filter((item) => item.id !== entry.id), "Запись дневника удалена");
  };

  return (
    <Modal title={entry ? "Редактирование дневника" : "Новая запись дневника"} onClose={onClose} large>
      <form onSubmit={submit}>
        {!entry && (
          <div className="template-picker">
            <span><Sparkles />Шаблоны дневника</span>
            <div>{diaryTemplates.map((item) => (
              <button type="button" key={item.title} onClick={() => setForm((current) => ({ ...current, ...item }))}>{item.title}</button>
            ))}</div>
          </div>
        )}
        <div className="form-grid">
          <Field label="Дата и время"><input type="datetime-local" value={(form.date || "").slice(0, 16)} onChange={(event) => set("date", event.target.value)} /></Field>
          <Field label="Тип записи"><select value={form.type} onChange={(event) => set("type", event.target.value)}>{["Выполнено", "План", "Динамика", "Контроль", "Комментарий", "Риск", "Другое"].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Заголовок *" full><input value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="Например: лечение 16, контроль динамики" autoFocus /></Field>
          <Field label="Зуб / область"><input value={form.teeth || ""} onChange={(event) => set("teeth", event.target.value)} placeholder="Например: 16, 24–26" /></Field>
          <Field label="Что сделали / что наблюдаем *" full><textarea value={form.text} onChange={(event) => set("text", event.target.value)} placeholder="Опишите лечение, состояние, жалобы, динамику или важные договорённости." /></Field>
          <Field label="Что дальше" full><textarea value={form.next_step || ""} onChange={(event) => set("next_step", event.target.value)} placeholder="Следующий этап, контроль, что подготовить к будущему визиту." /></Field>
        </div>
        <div className="modal-actions treatment-editor-actions">
          {entry && <button type="button" className="danger-action" disabled={busy} onClick={remove}><Trash2 />Удалить</button>}
          <span />
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Отмена</button>
          <button className="primary" disabled={busy}>{busy ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Anamnesis({ patient }) {
  const a = patient.anamnesis || {};
  const risks = [
    ["Беременность / лактация", a.pregnancy],
    ["Сахарный диабет", a.diabetes],
    ["Сердечно-сосудистые заболевания", a.cardiovascular],
    ["Артериальная гипертензия", a.hypertension],
    ["Бронхиальная астма", a.asthma],
    ["Эпилепсия", a.epilepsy],
    ["Приём антикоагулянтов", a.anticoagulants],
    ["Инфекционные заболевания", a.infectious]
  ].filter(([, enabled]) => enabled);
  return (
    <div className="detail-grid">
      {a.allergies && <div className="risk-card red"><strong>Аллергии</strong><p>{a.allergies}</p></div>}
      {a.contraindications && <div className="risk-card orange"><strong>Противопоказания</strong><p>{a.contraindications}</p></div>}
      <InfoCard title="Активные риски" icon={<Activity />}>
        {risks.length ? risks.map(([name]) => <div className="risk-row" key={name}><span />{name}</div>) : <p className="muted">Активные риски не отмечены.</p>}
      </InfoCard>
      <InfoCard title="Подробности" icon={<FileText />}>
        <InfoRow label="Хронические заболевания" value={a.chronic || "—"} />
        <InfoRow label="Текущие препараты" value={a.medications || "—"} />
        <InfoRow label="Особенности анестезии" value={a.anesthesia || "—"} />
        <InfoRow label="Дополнительно" value={a.additional || "—"} />
      </InfoCard>
    </div>
  );
}

function VisitsSection({ visits, transactions = [], onAdd, onEdit }) {
  return (
    <div className="section-block">
      <div className="section-heading"><div><h2>Визиты</h2><p>{visits.length} записей</p></div><button className="primary" onClick={onAdd}><Plus />Добавить</button></div>
      {visits.length ? <div className="visits-list">{visits.map((visit) => {
        const visitFinance = visitFinancials(visit, transactions);
        return (
          <button className="visit-card" key={visit.id} onClick={() => onEdit(visit)}>
            <div className="visit-top"><div><h3>{visit.treatment_type}</h3><p>{safeDate(visit.date)} · {visit.visit_kind || "Визит"} · {visit.teeth || "Область не указана"}</p></div><strong>{money.format(visit.total_cost || 0)}</strong></div>
            <p>{visit.diagnosis || visit.procedure_description || "Описание не заполнено"}</p>
            <div className="finance-line"><span className="positive">Оплачено {money.format(visitFinance.paid)}</span><span className={visitFinance.debt ? "negative" : "positive"}>Долг {money.format(visitFinance.debt)}</span></div>
          </button>
        );
      })}</div> : <Empty icon={<CalendarDays />} title="Визитов пока нет" text="Добавьте первый визит и стоимость лечения." action={onAdd} />}
    </div>
  );
}

function PatientFinance({ patient, data, finance, onAdd }) {
  const transactions = data.transactions.filter((t) => t.patient_id === patient.id);
  return (
    <div className="section-block">
      <div className="metric-grid">
        <Metric title="Стоимость" value={money.format(finance.cost)} icon={<FileText />} />
        <Metric title="Оплачено" value={money.format(finance.paid)} tone="green" icon={<Check />} />
        <Metric title="Расходы" value={money.format(finance.expenses)} tone="orange" icon={<ArrowUpRight />} />
        <Metric title="Чистая выручка" value={money.format(finance.net)} icon={<WalletCards />} />
        <Metric title="Задолженность" value={money.format(finance.debt)} tone="red" icon={<CircleDollarSign />} />
        {finance.manualDebt > 0 && <Metric title="Добавлено вручную" value={money.format(finance.manualDebt)} tone="red" icon={<CircleDollarSign />} />}
        {finance.discounts > 0 && <Metric title="Скидки" value={money.format(finance.discounts)} tone="orange" icon={<ArrowUpRight />} />}
      </div>
      <div className="section-heading"><div><h2>Операции пациента</h2></div><button className="primary" onClick={onAdd}><Plus />Добавить</button></div>
      <TransactionsList transactions={transactions} />
    </div>
  );
}

function PhotosSection({ photos, visits, onAdd, refresh, notify }) {
  const [selected, setSelected] = useState(null);
  const remove = async (photo) => {
    if (!confirm("Удалить фотографию безвозвратно?")) return;
    await deletePhoto(photo);
    await refresh();
    setSelected(null);
    notify("Фотография удалена");
  };
  return (
    <div className="section-block">
      <div className="section-heading"><div><h2>Фотопротокол</h2><p>{photos.length} изображений</p></div><button className="primary" onClick={onAdd}><Camera />Добавить</button></div>
      {photos.length ? (
        <div className="photo-grid">
          {photos.map((photo) => <button className="photo-card" key={photo.id} onClick={() => setSelected(photo)}>
            <img src={photo.signed_url} alt={photo.category} /><span>{photo.category}</span>
          </button>)}
        </div>
      ) : <Empty icon={<ImageIcon />} title="Фотографий пока нет" text="Добавьте фото до лечения, этапы и результат." action={onAdd} />}
      {selected && (
        <div className="lightbox" onClick={() => setSelected(null)}>
          <button className="lightbox-close"><X /></button>
          <img src={selected.signed_url} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
            <strong>{selected.category}</strong>
            <p>{selected.comment || "Комментарий не добавлен"}</p>
            <button className="danger" onClick={() => remove(selected)}><Trash2 />Удалить</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotesSection({ patient, clinicId, refresh, notify }) {
  const [note, setNote] = useState(patient.general_note || "");
  const submit = async () => {
    await savePatient(clinicId, { ...patient, general_note: note });
    await refresh();
    notify("Заметка сохранена");
  };
  return (
    <InfoCard title="Заметки" icon={<FileText />}>
      <textarea className="note-editor" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Клинические заметки, договорённости и рекомендации…" />
      <button className="primary" onClick={submit}>Сохранить заметку</button>
    </InfoCard>
  );
}

function FinancePage({ data, clinicId, refresh, notify }) {
  const [period, setPeriod] = useState("Месяц");
  const [editor, setEditor] = useState(false);
  const filtered = useMemo(() => filterTransactions(data.transactions, period), [data.transactions, period]);
  const income = sum(filtered.filter(isIncome), (t) => t.amount);
  const expense = sum(filtered.filter(isExpense), (t) => t.amount);
  const debt = sum(data.patients, (p) => patientFinancials(p.id, data).debt);
  const paidVisits = new Set(filtered.filter(isIncome).map((t) => t.visit_id).filter(Boolean)).size;
  const average = income / Math.max(1, paidVisits || filtered.filter(isIncome).length);
  const chart = chartData(filtered);
  const categories = categoryData(filtered.filter(isExpense));

  const exportCSV = () => {
    const rows = [["Дата", "Тип", "Сумма", "Категория", "Пациент", "Способ оплаты", "Комментарий"]];
    filtered.forEach((t) => rows.push([
      safeDate(t.date), t.type, t.amount, t.category,
      data.patients.find((p) => p.id === t.patient_id)?.full_name || "",
      t.payment_method || "", t.comment || ""
    ]));
    const csv = "\ufeff" + rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `CURE-finance-${todayISO()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <PageHeader title="Финансы" subtitle="Доходы, расходы и чистая выручка">
        <button className="secondary" onClick={exportCSV}><Download />CSV</button>
        <button className="primary" onClick={() => setEditor(true)}><Plus />Запись</button>
      </PageHeader>
      <div className="period-tabs">
        {["Сегодня", "Неделя", "Месяц", "Квартал", "Год"].map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}
      </div>
      <div className="metric-grid finance-metrics">
        <Metric title="Доход" value={money.format(income)} tone="green" icon={<ArrowDownLeft />} />
        <Metric title="Расход" value={money.format(expense)} tone="orange" icon={<ArrowUpRight />} />
        <Metric title="Чистая выручка" value={money.format(income - expense)} icon={<WalletCards />} />
        <Metric title="Общий долг" value={money.format(debt)} tone="red" icon={<CircleDollarSign />} />
        <Metric title="Средний чек" value={money.format(average)} icon={<Activity />} />
        <Metric title="Пациентов" value={new Set(filtered.map((t) => t.patient_id).filter(Boolean)).size} icon={<Users />} />
      </div>
      <div className="charts-grid">
        <InfoCard title="Динамика" icon={<BarChart3 />}>
          {chart.length ? <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}>
            <defs>
              <linearGradient id="income" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#A88C45" stopOpacity={0.3}/><stop offset="95%" stopColor="#A88C45" stopOpacity={0}/></linearGradient>
              <linearGradient id="expense" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#9A3B3B" stopOpacity={0.16}/><stop offset="95%" stopColor="#9A3B3B" stopOpacity={0}/></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe7eb" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={52} />
            <Tooltip contentStyle={{ border: "1px solid #E6E1D6", borderRadius: 14, boxShadow: "0 12px 32px rgba(28,28,30,.08)" }} formatter={(value) => money.format(value)} /><Legend />
            <Area type="monotone" dataKey="Доход" stroke="#A88C45" fill="url(#income)" strokeWidth={2.2} />
            <Area type="monotone" dataKey="Расход" stroke="#9A3B3B" fill="url(#expense)" strokeWidth={2.2} />
          </AreaChart></ResponsiveContainer></div> : <p className="muted">Недостаточно данных для графика.</p>}
        </InfoCard>
        <InfoCard title="Расходы по категориям" icon={<BarChart3 />}>
          {categories.length ? <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={categories} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#dfe7eb" />
            <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis dataKey="name" type="category" width={88} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ border: "1px solid #E6E1D6", borderRadius: 14, boxShadow: "0 12px 32px rgba(28,28,30,.08)" }} formatter={(value) => money.format(value)} /><Bar dataKey="value" fill="#A88C45" radius={[0, 7, 7, 0]} />
          </BarChart></ResponsiveContainer></div> : <p className="muted">Расходов за период нет.</p>}
        </InfoCard>
      </div>
      <div className="section-heading"><div><h2>Финансовые записи</h2><p>{filtered.length} за период</p></div></div>
      <TransactionsList transactions={filtered} patients={data.patients} onDelete={async (t) => {
        if (!confirm("Удалить финансовую запись?")) return;
        await deleteTransaction(clinicId, t.id); await refresh(); notify("Запись удалена");
      }} />
      {editor && <TransactionEditor patients={data.patients} visits={data.visits} transactions={data.transactions} clinicId={clinicId} onClose={() => setEditor(false)} onSaved={async () => { await refresh(); setEditor(false); notify("Финансовая запись сохранена"); }} />}
    </section>
  );
}

function PatientEditor({ patient, visits = [], clinicId, onClose, onSaved }) {
  const [form, setForm] = useState(patient ? structuredClone(patient) : {
    full_name: "", birth_date: "", gender: "Не указан", phone: "", second_phone: "", email: "",
    address: "", profession: "", source: "Рекомендации", first_visit_date: todayISO(),
    status: "Новый", general_note: "", anamnesis: {}, dental: {}
  });
  const [nextAppointment, setNextAppointment] = useState("");
  const [appointmentType, setAppointmentType] = useState("Консультация");
  const [tab, setTab] = useState("Анкета");
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setNested = (group, key, value) => setForm((f) => ({ ...f, [group]: { ...(f[group] || {}), [key]: value } }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.full_name.trim()) return alert("Введите ФИО пациента");
    if (form.birth_date && new Date(form.birth_date) > new Date()) return alert("Дата рождения не может быть в будущем");
    if (nextAppointment && new Date(nextAppointment) < new Date()) return alert("Следующая запись не может быть в прошлом");
    const phoneError = phoneValidationMessage(form.phone);
    if (phoneError) return alert(`Основной телефон: ${phoneError}`);
    const secondPhoneError = phoneValidationMessage(form.second_phone);
    if (secondPhoneError) return alert(`Дополнительный телефон: ${secondPhoneError}`);
    const representativePhoneError = phoneValidationMessage(representative.phone);
    if (representativePhoneError) return alert(`Телефон представителя: ${representativePhoneError}`);
    if (!patient && nextAppointment) {
      const nextInterval = visitInterval(nextAppointment);
      const conflict = visits.find((visit) => intervalsOverlap(visitInterval(visit.date), nextInterval));
      if (conflict) {
        return alert(`На ${safeDate(nextAppointment)} в ${timeLabel(nextAppointment)} есть пересечение с другой записью (${timeLabel(conflict.date)}–${timeLabel(new Date(new Date(conflict.date).getTime() + DEFAULT_VISIT_DURATION_MINUTES * 60000))}). Выберите другое время.`);
      }
    }
    const payload = structuredClone(form);
    payload.phone = normalizePhone(payload.phone);
    payload.second_phone = normalizePhone(payload.second_phone);
    if (payload.dental?.communication?.representative?.phone) {
      payload.dental.communication.representative.phone = normalizePhone(payload.dental.communication.representative.phone);
    }
    setBusy(true);
    try {
      const savedPatient = await savePatient(clinicId, payload);
      if (!patient && nextAppointment) {
        await saveVisit(clinicId, {
          patient_id: savedPatient.id,
          date: new Date(nextAppointment).toISOString(),
          teeth: "",
          visit_kind: "Первичный визит",
          treatment_type: appointmentType,
          complaint: "",
          diagnosis: "",
          procedure_description: "",
          materials: "",
          anesthesia: "",
          recommendations: "",
          doctor_notes: "",
          total_cost: 0,
          paid_amount: 0,
          discount: 0,
          refund: 0,
          next_visit_date: ""
        });
      }
      await onSaved(patient ? "Карточка обновлена" : nextAppointment ? "Пациент добавлен и записан на приём" : "Пациент добавлен без записи");
    }
    catch (error) { alert(error.message || "Не удалось сохранить пациента"); }
    finally { setBusy(false); }
  };
  const a = form.anamnesis || {};
  const d = form.dental || {};
  const c = d.communication || {};
  const representative = c.representative || {};
  const setCommunication = (key, value) => setForm((f) => ({
    ...f,
    dental: {
      ...(f.dental || {}),
      communication: { ...((f.dental || {}).communication || {}), [key]: value }
    }
  }));
  const setRepresentative = (key, value) => setForm((f) => {
    const communication = ((f.dental || {}).communication || {});
    return {
      ...f,
      dental: {
        ...(f.dental || {}),
        communication: {
          ...communication,
          representative: { ...(communication.representative || {}), [key]: value }
        }
      }
    };
  });
  return (
    <Modal title={patient ? "Редактирование пациента" : "Новый пациент"} onClose={onClose} large>
      <form onSubmit={submit}>
        <div className="form-tabs">{["Анкета", "Связь", "Анамнез", "Стоматология"].map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
        {tab === "Анкета" && <div className="form-grid">
          <Field label="ФИО *" full><input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} autoFocus /></Field>
          <Field label="Дата рождения"><input type="date" value={form.birth_date || ""} onChange={(e) => set("birth_date", e.target.value)} /></Field>
          <Field label="Пол"><select value={form.gender} onChange={(e) => set("gender", e.target.value)}>{["Не указан", "Женский", "Мужской"].map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Телефон"><input type="tel" value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Дополнительный телефон"><input type="tel" value={form.second_phone || ""} onChange={(e) => set("second_phone", e.target.value)} /></Field>
          <Field label="Email"><input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Профессия"><input value={form.profession || ""} onChange={(e) => set("profession", e.target.value)} /></Field>
          <Field label="Адрес" full><input value={form.address || ""} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Источник"><select value={form.source} onChange={(e) => set("source", e.target.value)}>{["Instagram", "Рекомендации", "Сайт", "Клиника", "Другое"].map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Статус"><select value={form.status} onChange={(e) => set("status", e.target.value)}>{["Новый", "На лечении", "Завершён", "Контроль", "Должник", "Архив"].map((v) => <option key={v}>{v}</option>)}</select></Field>
          {!patient && (
            <div className="optional-appointment full">
              <div><CalendarDays /><span><strong>Следующая запись</strong><small>Необязательно — пациента можно сохранить без даты приёма</small></span></div>
              <div className="form-grid">
                <Field label="Дата и время (необязательно)"><input type="datetime-local" value={nextAppointment} onChange={(event) => setNextAppointment(event.target.value)} /></Field>
                <Field label="Цель визита"><select value={appointmentType} disabled={!nextAppointment} onChange={(event) => setAppointmentType(event.target.value)}>{["Консультация", "Профессиональная гигиена", "Лечение кариеса", "Эндодонтическое лечение", "Реставрация", "Удаление зуба", "Хирургический приём", "Пародонтологическое лечение", "Ортопедический этап", "Ортодонтический приём", "Имплантация", "Контрольный осмотр", "Другое"].map((value) => <option key={value}>{value}</option>)}</select></Field>
              </div>
              {nextAppointment && <button type="button" className="clear-appointment" onClick={() => setNextAppointment("")}><X />Убрать запись и сохранить только пациента</button>}
            </div>
          )}
          <Field label="Заметка" full><textarea value={form.general_note || ""} onChange={(e) => set("general_note", e.target.value)} /></Field>
        </div>}
        {tab === "Связь" && <div className="form-grid">
          <Field label="Telegram username"><input value={c.telegram_username || ""} onChange={(e) => setCommunication("telegram_username", normalizeTelegramUsername(e.target.value))} placeholder="@patient_name" /></Field>
          <Field label="Предпочтительный способ связи">
            <select value={c.preferred_channel || ""} onChange={(e) => setCommunication("preferred_channel", e.target.value)}>
              {["", "Звонок", "Telegram", "WhatsApp", "SMS", "Через представителя", "Не беспокоить"].map((value) => <option key={value} value={value}>{value || "Не указано"}</option>)}
            </select>
          </Field>
          <Field label="Комментарий по связи" full><textarea value={c.contact_note || ""} onChange={(e) => setCommunication("contact_note", e.target.value)} placeholder="Например: писать после 18:00, не звонить утром." /></Field>
          <Field label="Важное для врача" full><textarea value={c.important_note || ""} onChange={(e) => setCommunication("important_note", e.target.value)} placeholder="Например: тревожный пациент, связь только через Telegram." /></Field>
          <div className="toggle-grid full">
            <label className="toggle-row"><span>Разрешены сообщения пациенту</span><input type="checkbox" checked={Boolean(c.messaging_allowed)} onChange={(e) => setCommunication("messaging_allowed", e.target.checked)} /></label>
            <label className="toggle-row"><span>Нужно связаться</span><input type="checkbox" checked={Boolean(c.follow_up_needed)} onChange={(e) => setCommunication("follow_up_needed", e.target.checked)} /></label>
          </div>
          <Field label="Причина связи"><input value={c.follow_up_reason || ""} onChange={(e) => setCommunication("follow_up_reason", e.target.value)} placeholder="Например: подтвердить визит" /></Field>
          <Field label="Следующий контакт"><input type="date" value={c.next_contact_date || ""} onChange={(e) => setCommunication("next_contact_date", e.target.value)} /></Field>
          <div className="form-divider full">Представитель пациента</div>
          <Field label="ФИО представителя"><input value={representative.name || ""} onChange={(e) => setRepresentative("name", e.target.value)} /></Field>
          <Field label="Кем приходится"><input value={representative.relation || ""} onChange={(e) => setRepresentative("relation", e.target.value)} placeholder="Мама, супруг, дочь" /></Field>
          <Field label="Телефон представителя"><input type="tel" value={representative.phone || ""} onChange={(e) => setRepresentative("phone", e.target.value)} /></Field>
          <Field label="Telegram представителя"><input value={representative.telegram || ""} onChange={(e) => setRepresentative("telegram", normalizeTelegramUsername(e.target.value))} placeholder="@relative" /></Field>
        </div>}
        {tab === "Анамнез" && <div className="form-grid">
          <Field label="Аллергии" full><textarea value={a.allergies || ""} onChange={(e) => setNested("anamnesis", "allergies", e.target.value)} /></Field>
          <Field label="Лекарственная непереносимость" full><textarea value={a.drug_intolerance || ""} onChange={(e) => setNested("anamnesis", "drug_intolerance", e.target.value)} /></Field>
          <Field label="Хронические заболевания" full><textarea value={a.chronic || ""} onChange={(e) => setNested("anamnesis", "chronic", e.target.value)} /></Field>
          <div className="toggle-grid full">
            {[
              ["pregnancy", "Беременность / лактация"], ["diabetes", "Сахарный диабет"],
              ["cardiovascular", "Сердечно-сосудистые заболевания"], ["hypertension", "Артериальная гипертензия"],
              ["asthma", "Бронхиальная астма"], ["epilepsy", "Эпилепсия"],
              ["anticoagulants", "Приём антикоагулянтов"], ["infectious", "Инфекционные заболевания"]
            ].map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(a[key])} onChange={(e) => setNested("anamnesis", key, e.target.checked)} /></label>)}
          </div>
          <Field label="Текущие препараты" full><textarea value={a.medications || ""} onChange={(e) => setNested("anamnesis", "medications", e.target.value)} /></Field>
          <Field label="Особенности анестезии" full><textarea value={a.anesthesia || ""} onChange={(e) => setNested("anamnesis", "anesthesia", e.target.value)} /></Field>
          <Field label="Противопоказания" full><textarea value={a.contraindications || ""} onChange={(e) => setNested("anamnesis", "contraindications", e.target.value)} /></Field>
          <Field label="Дополнительный анамнез" full><textarea value={a.additional || ""} onChange={(e) => setNested("anamnesis", "additional", e.target.value)} /></Field>
        </div>}
        {tab === "Стоматология" && <div className="form-grid">
          <Field label="Жалобы" full><textarea value={d.complaints || ""} onChange={(e) => setNested("dental", "complaints", e.target.value)} /></Field>
          <Field label="Объективный статус" full><textarea value={d.objective_status || ""} onChange={(e) => setNested("dental", "objective_status", e.target.value)} /></Field>
          <Field label="Зубы FDI"><input value={d.fdi_teeth || ""} onChange={(e) => setNested("dental", "fdi_teeth", e.target.value)} placeholder="11, 16, 24" /></Field>
          <Field label="МКБ-10"><input value={d.icd10 || ""} onChange={(e) => setNested("dental", "icd10", e.target.value)} /></Field>
          <Field label="Диагноз" full><textarea value={d.diagnosis || ""} onChange={(e) => setNested("dental", "diagnosis", e.target.value)} /></Field>
          <Field label="План лечения" full><textarea value={d.treatment_plan || ""} onChange={(e) => setNested("dental", "treatment_plan", e.target.value)} /></Field>
          <Field label="Рекомендации" full><textarea value={d.recommendations || ""} onChange={(e) => setNested("dental", "recommendations", e.target.value)} /></Field>
          <Field label="Клинические заметки" full><textarea value={d.clinical_notes || ""} onChange={(e) => setNested("dental", "clinical_notes", e.target.value)} /></Field>
        </div>}
        <ModalActions busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function VisitEditor({ patient, visit, presetDate, visits = [], clinicId, onClose, onSaved, onDeleted, onOpenPatient }) {
  const [form, setForm] = useState(visit ? structuredClone(visit) : {
    patient_id: patient.id, date: presetDate || localDateTimeInput(new Date()), teeth: "",
    visit_kind: "Первичный визит", treatment_type: "Консультация", complaint: "", diagnosis: "", procedure_description: "",
    materials: "", anesthesia: "", recommendations: "", doctor_notes: "",
    total_cost: 0, paid_amount: 0, discount: 0, refund: 0, next_visit_date: ""
  });
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const debt = Math.max(0, Number(form.total_cost) - Number(form.discount) - Number(form.paid_amount) + Number(form.refund));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.date) return alert("Укажите дату и время визита");
    if ([form.total_cost, form.paid_amount, form.discount, form.refund].some((v) => Number(v) < 0)) return alert("Сумма не может быть отрицательной");
    if (Number(form.paid_amount) > Number(form.total_cost) - Number(form.discount) + Number(form.refund)) return alert("Оплата превышает стоимость");
    const targetInterval = visitInterval(form.date);
    const conflict = visits.find((item) => item.id !== form.id && intervalsOverlap(visitInterval(item.date), targetInterval));
    if (conflict) {
      const conflictPatient = conflict.patient_name || "";
      const conflictEnd = new Date(new Date(conflict.date).getTime() + DEFAULT_VISIT_DURATION_MINUTES * 60000);
      return alert(`На ${safeDate(form.date)} в ${timeLabel(form.date)} есть пересечение с записью ${timeLabel(conflict.date)}–${timeLabel(conflictEnd)}${conflictPatient ? `: ${conflictPatient}` : ""}. Выберите другое время.`);
    }
    const payload = {
      ...form,
      date: new Date(form.date).toISOString(),
      next_visit_date: form.next_visit_date ? new Date(form.next_visit_date).toISOString() : ""
    };
    setBusy(true);
    try { await saveVisit(clinicId, payload); await onSaved(); }
    catch (error) { alert(error.message || "Не удалось сохранить визит"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!visit || !confirm("Удалить только эту запись визита? Карточка пациента останется.")) return;
    setBusy(true);
    try {
      await deleteVisit(clinicId, visit.id);
      const afterDelete = onDeleted || onSaved;
      if (afterDelete) await afterDelete();
    } catch (error) {
      alert(error.message || "Не удалось удалить визит");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={visit ? "Редактирование визита" : "Новый визит"} onClose={onClose} large>
      <form onSubmit={submit}>
        {visit && (
          <div className="visit-editor-notice">
            <CalendarDays />
            <span><strong>Вы редактируете запись визита.</strong><small>Удаление здесь удалит только запись в календаре, не карточку пациента.</small></span>
            {onOpenPatient && <button type="button" className="secondary" onClick={onOpenPatient}><UserRound />Карточка</button>}
          </div>
        )}
        <div className="form-grid">
          <Field label="Дата и время"><input type="datetime-local" value={form.date ? localDateTimeInput(form.date) : ""} onChange={(e) => set("date", e.target.value)} /></Field>
          <Field label="Тип визита"><select value={form.visit_kind || "Первичный визит"} onChange={(e) => set("visit_kind", e.target.value)}>{["Первичный визит", "Повторный визит", "Контрольный визит", "Экстренный визит", "Онлайн-консультация", "Другое"].map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Вид лечения"><select value={form.treatment_type} onChange={(e) => set("treatment_type", e.target.value)}>{["Консультация", "Профессиональная гигиена", "Лечение кариеса", "Эндодонтическое лечение", "Реставрация", "Удаление зуба", "Хирургический приём", "Пародонтологическое лечение", "Ортопедический этап", "Ортодонтический приём", "Имплантация", "Контрольный осмотр", "Другое"].map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Зуб / область (FDI)"><input value={form.teeth || ""} onChange={(e) => set("teeth", e.target.value)} /></Field>
          <Field label="Диагноз"><input value={form.diagnosis || ""} onChange={(e) => set("diagnosis", e.target.value)} /></Field>
          <Field label="Жалобы" full><textarea value={form.complaint || ""} onChange={(e) => set("complaint", e.target.value)} /></Field>
          <Field label="Выполненная манипуляция" full><textarea value={form.procedure_description || ""} onChange={(e) => set("procedure_description", e.target.value)} /></Field>
          <Field label="Материалы"><textarea value={form.materials || ""} onChange={(e) => set("materials", e.target.value)} /></Field>
          <Field label="Анестезия"><textarea value={form.anesthesia || ""} onChange={(e) => set("anesthesia", e.target.value)} /></Field>
          <Field label="Рекомендации" full><textarea value={form.recommendations || ""} onChange={(e) => set("recommendations", e.target.value)} /></Field>
          <div className="form-divider full">Финансы визита</div>
          {["total_cost", "paid_amount", "discount", "refund"].map((key) => <Field key={key} label={{ total_cost: "Стоимость", paid_amount: "Оплачено", discount: "Скидка", refund: "Возврат" }[key]}><input type="number" min="0" inputMode="decimal" value={form[key]} onChange={(e) => set(key, Number(e.target.value))} /></Field>)}
          <div className="debt-preview full"><span>Задолженность</span><strong>{money.format(debt)}</strong></div>
          <Field label="Следующий визит"><input type="datetime-local" value={form.next_visit_date ? localDateTimeInput(form.next_visit_date) : ""} onChange={(e) => set("next_visit_date", e.target.value)} /></Field>
        </div>
        <div className="modal-actions treatment-editor-actions">
          {visit && <button type="button" className="danger-action" disabled={busy} onClick={remove}><Trash2 />Удалить запись</button>}
          <span />
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Отмена</button>
          <button className="primary" disabled={busy}>{busy ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </form>
    </Modal>
  );
}

function TransactionEditor({ patients, visits, transactions = [], presetPatient, clinicId, onClose, onSaved }) {
  const [form, setForm] = useState({
    type: "Доход", amount: "", date: new Date().toISOString().slice(0, 16),
    category: "Консультация", payment_method: "Карта",
    patient_id: presetPatient?.id || "", visit_id: "", comment: ""
  });
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const categories = form.type === "Расход"
    ? ["Материалы", "Лаборатория", "Аренда", "Зарплата", "Ассистент", "Оборудование", "Расходники", "Реклама", "Обучение", "Налоги", "Комиссия", "Другое"]
    : form.type === "Долг"
      ? ["Лечение", "Визит", "Лаборатория", "Ортопедическая конструкция", "Имплантация", "Другое"]
    : ["Консультация", "Терапия", "Хирургия", "Ортопедия", "Ортодонтия", "Гигиена", "Имплантация", "Пародонтология", "Другое"];
  const patientVisits = visits.filter((v) => v.patient_id === form.patient_id);
  const selectedVisit = visits.find((visit) => visit.id === form.visit_id);
  const hasAutoVisitIncome = form.visit_id && (
    Number(selectedVisit?.paid_amount || 0) > 0 ||
    transactions.some((transaction) => transaction.visit_id === form.visit_id && isSyncedVisitIncome(transaction))
  );
  const hasAutoVisitRefund = form.visit_id && (
    Number(selectedVisit?.refund || 0) > 0 ||
    transactions.some((transaction) => transaction.visit_id === form.visit_id && isSyncedVisitRefund(transaction))
  );
  const submit = async (event) => {
    event.preventDefault();
    if (Number(form.amount) <= 0) return alert("Введите сумму");
    if (form.type === "Долг" && !form.patient_id) return alert("Для записи долга выберите пациента");
    if (form.type === "Доход" && form.visit_id && hasAutoVisitIncome) {
      return alert("Оплата этого визита уже создана автоматически из поля «Оплачено» в визите. Чтобы изменить оплату, откройте сам визит и измените поле «Оплачено», либо создайте доход без привязки к визиту.");
    }
    if (form.type === "Возврат" && form.visit_id && hasAutoVisitRefund) {
      return alert("Возврат этого визита уже создан автоматически из поля «Возврат» в визите. Чтобы изменить возврат, откройте сам визит и измените поле «Возврат», либо создайте возврат без привязки к визиту.");
    }
    setBusy(true);
    try { await saveTransaction(clinicId, { ...form, amount: Number(form.amount), patient_id: form.patient_id || null, visit_id: form.visit_id || null }); await onSaved(); }
    catch (error) { alert(error.message || "Не удалось сохранить запись"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Финансовая запись" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Тип"><select value={form.type} onChange={(e) => {
            const nextType = e.target.value;
            set("type", nextType);
            set("category", nextType === "Расход" ? "Материалы" : nextType === "Долг" ? "Лечение" : "Консультация");
          }}>{["Доход", "Долг", "Расход", "Возврат", "Скидка", "Коррекция"].map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Сумма"><input type="number" min="0" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} autoFocus /></Field>
          <Field label="Дата"><input type="datetime-local" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
          <Field label="Категория"><select value={form.category} onChange={(e) => set("category", e.target.value)}>{categories.map((v) => <option key={v}>{v}</option>)}</select></Field>
          {form.type !== "Долг" && <Field label="Способ оплаты"><select value={form.payment_method} onChange={(e) => set("payment_method", e.target.value)}>{["Наличные", "Карта", "Перевод", "Рассрочка", "Другое"].map((v) => <option key={v}>{v}</option>)}</select></Field>}
          <Field label="Пациент"><select value={form.patient_id} onChange={(e) => { set("patient_id", e.target.value); set("visit_id", ""); }}><option value="">Не выбран</option>{patients.map((p) => <option value={p.id} key={p.id}>{p.full_name}</option>)}</select></Field>
          <Field label="Визит" full><select value={form.visit_id} onChange={(e) => set("visit_id", e.target.value)}><option value="">Без привязки к визиту</option>{patientVisits.map((v) => <option value={v.id} key={v.id}>{safeDate(v.date)} · {v.visit_kind || "Визит"} · {v.treatment_type}</option>)}</select></Field>
          {form.visit_id && ((form.type === "Доход" && hasAutoVisitIncome) || (form.type === "Возврат" && hasAutoVisitRefund)) && (
            <div className="document-notice full"><AlertTriangle />У этого визита уже есть автоматическая финансовая операция. Изменяйте сумму внутри визита, чтобы не получить двойной учёт.</div>
          )}
          <Field label="Комментарий" full><textarea value={form.comment} onChange={(e) => set("comment", e.target.value)} /></Field>
        </div>
        <ModalActions busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function PhotoUploader({ patient, visits, clinicId, onClose, onSaved, presetTooth }) {
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState("До лечения");
  const [visitId, setVisitId] = useState("");
  const [comment, setComment] = useState(presetTooth ? `Фото привязано к зубу ${presetTooth}` : "");
  const [busy, setBusy] = useState(false);
  const appendFiles = (list) => {
    const accepted = [];
    for (const file of list) {
      if (!isAcceptedImageFile(file)) {
        alert(`Файл «${file.name}» не похож на изображение.`);
        continue;
      }
      if (file.size > MAX_PHOTO_SIZE_BYTES) {
        alert(`Фото «${file.name}» слишком большое. Максимум ${MAX_PHOTO_SIZE_MB} МБ на одно фото.`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length) setFiles((current) => [...current, ...accepted]);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!files.length) return alert("Выберите фотографии");
    setBusy(true);
    try {
      const finalCategory = presetTooth ? `Зуб ${presetTooth} · ${category}` : category;
      await uploadPhotos(clinicId, patient.id, visitId, finalCategory, files, comment);
      await onSaved();
    }
    catch (error) { alert(error.message || "Не удалось добавить фото"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={presetTooth ? `Добавление фото зуба ${presetTooth}` : "Добавление фото"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          {presetTooth && <div className="selected-files full"><Camera />Фото будет привязано к зубу {presetTooth}</div>}
          <Field label="Категория"><select value={category} onChange={(e) => setCategory(e.target.value)}>{["До лечения", "Этап лечения", "После лечения", "Рентген / КЛКТ", "Документы", "Другое"].map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Привязать к визиту"><select value={visitId} onChange={(e) => setVisitId(e.target.value)}><option value="">Без привязки</option>{visits.map((v) => <option value={v.id} key={v.id}>{safeDate(v.date)} · {v.visit_kind || "Визит"} · {v.treatment_type}</option>)}</select></Field>
          <Field label="Комментарий" full><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий к фото" /></Field>
          <label className="upload-zone">
            <Upload />
            <strong>Выбрать из галереи</strong>
            <span>JPG, PNG, WEBP, HEIC/HEIF до {MAX_PHOTO_SIZE_MB} МБ на фото</span>
            <input type="file" accept="image/*" multiple onChange={(e) => appendFiles([...e.target.files])} />
          </label>
          <label className="upload-zone">
            <Camera />
            <strong>Снять на камеру</strong>
            <span>Фото будет сжато перед загрузкой</span>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => appendFiles([...e.target.files])} />
          </label>
          {files.length > 0 && <div className="selected-files full"><Check />Выбрано: {files.length}</div>}
        </div>
        <ModalActions busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function DocumentUploader({ patient, clinicId, onClose, onSaved }) {
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState("Медицинский документ");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const maxSize = 50 * 1024 * 1024;
  const appendFiles = (list) => {
    const oversized = list.find((file) => file.size > maxSize);
    if (oversized) return alert(`Файл «${oversized.name}» больше 50 МБ`);
    setFiles((current) => [...current, ...list]);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!files.length) return alert("Выберите хотя бы один файл");
    setBusy(true);
    try {
      await uploadDocuments(clinicId, patient.id, category, comment.trim(), files);
      await onSaved();
    } catch (error) {
      alert(error.message || "Не удалось загрузить документы");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Добавление документов" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Категория" full>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {["Согласие", "Договор", "План лечения", "Рекомендации", "Анализы", "Рентген / КЛКТ", "Презентация", "Финансовый документ", "Медицинский документ", "Другое"].map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field label="Комментарий" full><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Необязательное описание документа" /></Field>
          <label className="upload-zone full document-upload-zone">
            <Upload />
            <strong>Выбрать файлы</strong>
            <span>PDF, Word, Excel, PowerPoint, изображения, текст и другие документы — до 50 МБ каждый</span>
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.jpg,.jpeg,.png,.webp,.heic,.zip"
              onChange={(event) => appendFiles([...event.target.files])}
            />
          </label>
          {files.length > 0 && (
            <div className="selected-document-files full">
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`}><FileText /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X /></button></div>
              ))}
            </div>
          )}
        </div>
        <ModalActions busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function SettingsSheet({ session, membership, clinic, close, notify }) {
  const copy = async () => {
    await navigator.clipboard.writeText(clinic.invite_code);
    notify("Код клиники скопирован");
  };
  return (
    <Modal title="Настройки" onClose={close}>
      <div className="settings-list">
        <div className="settings-identity"><div className="avatar large">{(membership.full_name || session.user.email)?.[0].toUpperCase()}</div><div><strong>{membership.full_name || session.user.email}</strong><span>{membership.job_title || (membership.role === "owner" ? "Владелец клиники" : "Сотрудник")}</span><span>{session.user.email}</span></div></div>
        <InfoCard title="Общая клиника" icon={<Users />}>
          <InfoRow label="Название" value={clinic.name} />
          <div className="invite-code"><div><span>Код приглашения</span><strong>{clinic.invite_code}</strong></div><button className="secondary" onClick={copy}>Копировать</button></div>
          <p className="muted small-text">Коллега регистрирует собственный аккаунт и вводит этот код. Данные будут общими, а пароли — разными.</p>
        </InfoCard>
        <InfoCard title="Приватность" icon={<ShieldCheck />}>
          <p>Доступ ограничен участниками клиники. Фотографии находятся в закрытом облачном хранилище и выдаются по временным ссылкам.</p>
        </InfoCard>
        {!cloudEnabled && <button className="secondary wide" onClick={() => { resetDemo(); location.reload(); }}><RefreshCw />Сбросить демо-данные</button>}
        {cloudEnabled && <button className="danger wide" onClick={() => supabase.auth.signOut()}><LogOut />Выйти</button>}
      </div>
    </Modal>
  );
}

function TransactionsList({ transactions, patients = [], onDelete }) {
  if (!transactions.length) return <Empty icon={<WalletCards />} title="Финансовых записей пока нет" text="Добавьте доход, расход или возврат." />;
  return <div className="transactions-list">{transactions.map((t) => {
    const positive = isIncome(t);
    const debt = isDebt(t);
    const patient = patients.find((p) => p.id === t.patient_id);
    return (
      <div className="transaction-row" key={t.id}>
        <div className={`transaction-icon ${positive ? "green" : "red"}`}>{positive ? <ArrowDownLeft /> : debt ? <CircleDollarSign /> : <ArrowUpRight />}</div>
        <div><strong>{debt ? `Долг · ${t.category}` : t.category}</strong><span>{[patient?.full_name, safeDate(t.date)].filter(Boolean).join(" · ")}</span></div>
        <b className={positive ? "positive" : "negative"}>{positive ? "+" : debt ? "+" : "−"}{money.format(t.amount)}</b>
        {onDelete && <button className="icon-button mini" onClick={() => onDelete(t)}><Trash2 /></button>}
      </div>
    );
  })}</div>;
}

function patientWarnings(patient) {
  const anamnesis = patient.anamnesis || {};
  const warnings = [];
  if (anamnesis.allergies) warnings.push(`Аллергия: ${anamnesis.allergies}`);
  if (anamnesis.drug_intolerance) warnings.push(`Непереносимость: ${anamnesis.drug_intolerance}`);
  if (anamnesis.anticoagulants) warnings.push("Принимает антикоагулянты");
  if (anamnesis.pregnancy) warnings.push("Беременность / лактация");
  if (anamnesis.diabetes) warnings.push("Сахарный диабет");
  if (anamnesis.cardiovascular) warnings.push("Сердечно-сосудистые заболевания");
  if (anamnesis.hypertension) warnings.push("Артериальная гипертензия");
  if (anamnesis.contraindications) warnings.push(`Противопоказания: ${anamnesis.contraindications}`);
  return warnings;
}

function formatFileSize(bytes = 0) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

function fileExtension(name = "") {
  const extension = name.includes(".") ? name.split(".").pop() : "FILE";
  return extension.slice(0, 5).toUpperCase();
}

function visitFinancials(visit, transactions = []) {
  const related = transactions.filter((t) => t.visit_id === visit.id);
  const total = Number(visit.total_cost || 0);
  const paid = Number(visit.paid_amount || 0) + sum(related.filter(isManualIncome), (t) => t.amount);
  const refund = Number(visit.refund || 0) + sum(related.filter(isManualRefund), (t) => t.amount);
  const discount = Number(visit.discount || 0) + sum(related.filter(isDiscount), (t) => t.amount);
  return {
    total,
    paid,
    refund,
    discount,
    debt: Math.max(0, total - discount - paid + refund)
  };
}

function patientFinancials(patientId, data) {
  const visits = data.visits.filter((v) => v.patient_id === patientId);
  const transactions = data.transactions.filter((t) => t.patient_id === patientId);
  const cost = sum(visits, (v) => Number(v.total_cost) - Number(v.discount || 0));
  const visitPaid = sum(visits, (v) => v.paid_amount);
  const manualIncome = sum(transactions.filter(isManualIncome), (t) => t.amount);
  const refunds = sum(visits, (v) => v.refund) + sum(transactions.filter(isManualRefund), (t) => t.amount);
  const expenses = sum(transactions.filter((t) => t.type === "Расход"), (t) => t.amount);
  const manualDebt = sum(transactions.filter(isDebt), (t) => t.amount);
  const discounts = sum(transactions.filter(isDiscount), (t) => t.amount);
  const paid = visitPaid + manualIncome;
  return { cost, paid, refunds, expenses, manualDebt, discounts, debt: Math.max(0, cost - paid + refunds + manualDebt - discounts), net: paid - expenses - refunds };
}

function filterTransactions(transactions, period) {
  const now = new Date();
  let start = new Date(now);
  if (period === "Сегодня") start.setHours(0, 0, 0, 0);
  if (period === "Неделя") start.setDate(now.getDate() - 6);
  if (period === "Месяц") start.setMonth(now.getMonth() - 1);
  if (period === "Квартал") start.setMonth(now.getMonth() - 3);
  if (period === "Год") start.setFullYear(now.getFullYear() - 1);
  return transactions.filter((t) => new Date(t.date) >= start).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function chartData(transactions) {
  const map = new Map();
  [...transactions].reverse().forEach((t) => {
    if (!isIncome(t) && !isExpense(t)) return;
    const key = new Date(t.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    if (!map.has(key)) map.set(key, { date: key, Доход: 0, Расход: 0 });
    map.get(key)[isIncome(t) ? "Доход" : "Расход"] += Number(t.amount);
  });
  return [...map.values()];
}

function categoryData(transactions) {
  const map = new Map();
  transactions.forEach((t) => map.set(t.category, (map.get(t.category) || 0) + Number(t.amount)));
  return [...map].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 7);
}

function PageHeader({ title, subtitle, children }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="header-actions">{children}</div></div>;
}
function Field({ label, children, full }) {
  return <label className={`field ${full ? "full" : ""}`}><span>{label}</span>{children}</label>;
}
function Modal({ title, onClose, children, large }) {
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className={`modal ${large ? "large" : ""}`}><header><h2>{title}</h2><button className="icon-button" onClick={onClose}><X /></button></header><div className="modal-body">{children}</div></section></div>;
}
function ModalActions({ busy, onCancel }) {
  return <div className="modal-actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button><button className="primary" disabled={busy}>{busy ? "Сохранение…" : "Сохранить"}</button></div>;
}
function Metric({ title, value, icon, tone = "blue" }) {
  return <div className={`metric-card ${tone}`}><div>{icon}<span>{title}</span></div><strong>{value}</strong></div>;
}
function InfoCard({ title, icon, children }) {
  return <article className="info-card"><header>{icon}<h3>{title}</h3></header><div>{children}</div></article>;
}
function InfoRow({ label, value }) {
  return <div className="info-row"><span>{label}</span><strong>{String(value)}</strong></div>;
}
function StatusBadge({ status }) {
  const tone = status === "Должник"
    ? "red"
    : status === "Завершён"
      ? "green"
      : status === "Контроль"
        ? "graphite"
        : status === "Архив"
          ? "gray"
          : status === "На лечении"
            ? "gold"
            : "blue";
  return <span className={`status-badge ${tone}`}>{status}</span>;
}
function Empty({ icon, title, text, action }) {
  return <div className="empty-state"><div>{icon}</div><h3>{title}</h3><p>{text}</p>{action && <button className="primary" onClick={action}><Plus />Добавить</button>}</div>;
}
