import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownLeft, ArrowUpRight, BarChart3, CalendarDays, Camera,
  Check, ChevronLeft, CircleDollarSign, Cloud, Download, Edit3, FileText,
  Filter, Image as ImageIcon, LockKeyhole, LogOut, Menu, MoreHorizontal,
  Phone, Plus, RefreshCw, Search, Settings, ShieldCheck, Stethoscope,
  Trash2, Upload, UserRound, Users, WalletCards, X
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from "recharts";
import { cloudEnabled, supabase } from "./supabase";
import {
  deletePatient, deletePhoto, deleteTransaction, loadClinicData, resetDemo,
  savePatient, saveTransaction, saveVisit, subscribeToClinic, updatePhoto,
  uploadPhotos
} from "./data";

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", maximumFractionDigits: 0
});
const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const todayISO = () => new Date().toISOString().slice(0, 10);
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
const isIncome = (t) => t.type === "Доход" || t.type === "Коррекция";
const isExpense = (t) => t.type === "Расход" || t.type === "Возврат";
const isDebt = (t) => t.type === "Долг";

export default function App() {
  const [session, setSession] = useState(cloudEnabled ? null : { user: { email: "demo@cure.app", id: "demo" } });
  const [authReady, setAuthReady] = useState(!cloudEnabled);
  // undefined = проверяем членство, null = у пользователя ещё нет клиники.
  const [membership, setMembership] = useState(cloudEnabled ? undefined : { clinic_id: "demo-clinic", role: "owner" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!cloudEnabled) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
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
        <h2>{mode === "login" ? "С возвращением" : mode === "join" ? "Войти в клинику" : "Создать аккаунт"}</h2>
        <p className="muted">
          {mode === "login" ? "Войдите в общую клинику CURE." : mode === "join" ? "Введите код клиники, ФИО, должность и данные для личного входа." : "Создайте аккаунт владельца, а затем новую клинику."}
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
          <Field label="Пароль">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Минимум 8 символов" />
          </Field>
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
          <button className="primary wide" disabled={busy}>{busy ? "Подождите…" : mode === "login" ? "Войти в CURE" : mode === "join" ? "Зарегистрироваться и войти по коду" : "Зарегистрироваться"}</button>
        </form>
        <p className="privacy-note"><LockKeyhole size={15} /> Медицинские данные доступны только участникам вашей клиники.</p>
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
  const [route, setRoute] = useState("patients");
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
        {route === "patients" && (
          <PatientsPage data={data} clinicId={membership.clinic_id} refresh={refresh} openPatient={openPatient} notify={notify} />
        )}
        {route === "patient" && selectedPatient && (
          <PatientPage patient={selectedPatient} data={data} clinicId={membership.clinic_id} refresh={refresh} back={goBack} notify={notify} />
        )}
        {route === "finance" && (
          <FinancePage data={data} clinicId={membership.clinic_id} refresh={refresh} notify={notify} />
        )}
      </main>

      <nav className="tabbar">
        <button className={route === "patients" || route === "patient" ? "active" : ""} onClick={goBack}>
          <Users /><span>Пациенты</span>
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
        const haystack = [patient.full_name, patient.phone, patient.dental?.diagnosis, patient.dental?.treatment_plan, ...visits.map((v) => v.treatment_type)].join(" ").toLowerCase();
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
      {editor && <PatientEditor clinicId={clinicId} onClose={() => setEditor(false)} onSaved={async () => { await refresh(); setEditor(false); notify("Пациент сохранён"); }} />}
    </section>
  );
}

function PatientCard({ patient, data, onClick }) {
  const visits = data.visits.filter((v) => v.patient_id === patient.id);
  const latest = visits.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const finance = patientFinancials(patient.id, data);
  const photo = data.photos.find((p) => p.patient_id === patient.id);
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
  const [statusBusy, setStatusBusy] = useState(false);
  const finance = patientFinancials(patient.id, data);
  const visits = data.visits.filter((v) => v.patient_id === patient.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const photos = data.photos.filter((p) => p.patient_id === patient.id);

  const remove = async () => {
    if (!confirm("Удалить пациента, все визиты, финансы и фотографии безвозвратно?")) return;
    await deletePatient(clinicId, patient.id, photos);
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

  return (
    <section>
      <div className="detail-nav">
        <button className="back-button" onClick={back}><ChevronLeft />Пациенты</button>
        <div className="detail-actions">
          {patient.phone && <a className="icon-button" href={`tel:${patient.phone}`}><Phone /></a>}
          <button className="icon-button" onClick={() => setEditPatient(true)}><Edit3 /></button>
          <button className="icon-button danger-ghost" onClick={remove}><Trash2 /></button>
        </div>
      </div>
      <div className="patient-hero card">
        <div>
          <p className="eyebrow">КАРТОЧКА ПАЦИЕНТА</p>
          <h1>{patient.full_name}</h1>
          <p>{age(patient.birth_date)} лет · {patient.phone || "Телефон не указан"}</p>
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
      <div className="chip-scroll">
        {["Обзор", "Анамнез", "Лечение", "Финансы", "Фото", "Заметки"].map((item) => (
          <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item}</button>
        ))}
      </div>

      {section === "Обзор" && <Overview patient={patient} visits={visits} finance={finance} />}
      {section === "Анамнез" && <Anamnesis patient={patient} />}
      {section === "Лечение" && (
        <VisitsSection visits={visits} onAdd={() => setVisitEditor({})} onEdit={setVisitEditor} />
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

      {editPatient && <PatientEditor patient={patient} clinicId={clinicId} onClose={() => setEditPatient(false)} onSaved={async () => { await refresh(); setEditPatient(false); notify("Карточка обновлена"); }} />}
      {visitEditor && <VisitEditor patient={patient} visit={visitEditor.id ? visitEditor : null} clinicId={clinicId} onClose={() => setVisitEditor(null)} onSaved={async () => { await refresh(); setVisitEditor(null); notify("Визит сохранён"); }} />}
      {photoEditor && <PhotoUploader patient={patient} visits={visits} clinicId={clinicId} onClose={() => setPhotoEditor(false)} onSaved={async () => { await refresh(); setPhotoEditor(false); notify("Фотографии добавлены"); }} />}
      {txEditor && <TransactionEditor patients={data.patients} visits={data.visits} presetPatient={patient} clinicId={clinicId} onClose={() => setTxEditor(false)} onSaved={async () => { await refresh(); setTxEditor(false); notify("Финансовая запись сохранена"); }} />}
    </section>
  );
}

function Overview({ patient, visits, finance }) {
  const latest = visits[0];
  const next = visits.filter((v) => v.next_visit_date && new Date(v.next_visit_date) >= new Date()).sort((a, b) => new Date(a.next_visit_date) - new Date(b.next_visit_date))[0];
  return (
    <div className="detail-grid">
      <InfoCard title="Основные данные" icon={<UserRound />}>
        <InfoRow label="Телефон" value={patient.phone || "—"} />
        <InfoRow label="Источник" value={patient.source || "—"} />
        <InfoRow label="Последний визит" value={latest ? safeDate(latest.date) : "—"} />
        <InfoRow label="Следующий визит" value={next ? safeDate(next.next_visit_date) : "Не назначен"} />
      </InfoCard>
      <InfoCard title="Текущий план" icon={<Stethoscope />}>
        <p>{patient.dental?.treatment_plan || "План лечения пока не заполнен."}</p>
      </InfoCard>
      <InfoCard title="Клинический статус" icon={<Activity />}>
        <InfoRow label="Диагноз" value={patient.dental?.diagnosis || "—"} />
        <InfoRow label="FDI" value={patient.dental?.fdi_teeth || "—"} />
        <InfoRow label="Визитов" value={visits.length} />
        <InfoRow label="Финансовый статус" value={finance.debt > 0 ? `Долг ${money.format(finance.debt)}` : "Оплачено"} />
      </InfoCard>
    </div>
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

function VisitsSection({ visits, onAdd, onEdit }) {
  return (
    <div className="section-block">
      <div className="section-heading"><div><h2>Визиты</h2><p>{visits.length} записей</p></div><button className="primary" onClick={onAdd}><Plus />Добавить</button></div>
      {visits.length ? <div className="visits-list">{visits.map((visit) => {
        const debt = Math.max(0, Number(visit.total_cost) - Number(visit.discount || 0) - Number(visit.paid_amount) + Number(visit.refund || 0));
        return (
          <button className="visit-card" key={visit.id} onClick={() => onEdit(visit)}>
            <div className="visit-top"><div><h3>{visit.treatment_type}</h3><p>{safeDate(visit.date)} · {visit.visit_kind || "Визит"} · {visit.teeth || "Область не указана"}</p></div><strong>{money.format(visit.total_cost || 0)}</strong></div>
            <p>{visit.diagnosis || visit.procedure_description || "Описание не заполнено"}</p>
            <div className="finance-line"><span className="positive">Оплачено {money.format(visit.paid_amount || 0)}</span><span className={debt ? "negative" : "positive"}>Долг {money.format(debt)}</span></div>
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
      {editor && <TransactionEditor patients={data.patients} visits={data.visits} clinicId={clinicId} onClose={() => setEditor(false)} onSaved={async () => { await refresh(); setEditor(false); notify("Финансовая запись сохранена"); }} />}
    </section>
  );
}

function PatientEditor({ patient, clinicId, onClose, onSaved }) {
  const [form, setForm] = useState(patient ? structuredClone(patient) : {
    full_name: "", birth_date: "", gender: "Не указан", phone: "", second_phone: "", email: "",
    address: "", profession: "", source: "Рекомендации", first_visit_date: todayISO(),
    status: "Новый", general_note: "", anamnesis: {}, dental: {}
  });
  const [tab, setTab] = useState("Анкета");
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setNested = (group, key, value) => setForm((f) => ({ ...f, [group]: { ...(f[group] || {}), [key]: value } }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.full_name.trim()) return alert("Введите ФИО пациента");
    if (form.birth_date && new Date(form.birth_date) > new Date()) return alert("Дата рождения не может быть в будущем");
    setBusy(true);
    try { await savePatient(clinicId, form); await onSaved(); }
    catch (error) { alert(error.message || "Не удалось сохранить пациента"); }
    finally { setBusy(false); }
  };
  const a = form.anamnesis || {};
  const d = form.dental || {};
  return (
    <Modal title={patient ? "Редактирование пациента" : "Новый пациент"} onClose={onClose} large>
      <form onSubmit={submit}>
        <div className="form-tabs">{["Анкета", "Анамнез", "Стоматология"].map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
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
          <Field label="Заметка" full><textarea value={form.general_note || ""} onChange={(e) => set("general_note", e.target.value)} /></Field>
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

function VisitEditor({ patient, visit, clinicId, onClose, onSaved }) {
  const [form, setForm] = useState(visit ? structuredClone(visit) : {
    patient_id: patient.id, date: new Date().toISOString().slice(0, 16), teeth: "",
    visit_kind: "Первичный визит", treatment_type: "Консультация", complaint: "", diagnosis: "", procedure_description: "",
    materials: "", anesthesia: "", recommendations: "", doctor_notes: "",
    total_cost: 0, paid_amount: 0, discount: 0, refund: 0, next_visit_date: ""
  });
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const debt = Math.max(0, Number(form.total_cost) - Number(form.discount) - Number(form.paid_amount) + Number(form.refund));
  const submit = async (event) => {
    event.preventDefault();
    if ([form.total_cost, form.paid_amount, form.discount, form.refund].some((v) => Number(v) < 0)) return alert("Сумма не может быть отрицательной");
    if (Number(form.paid_amount) > Number(form.total_cost) - Number(form.discount) + Number(form.refund)) return alert("Оплата превышает стоимость");
    setBusy(true);
    try { await saveVisit(clinicId, form); await onSaved(); }
    catch (error) { alert(error.message || "Не удалось сохранить визит"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={visit ? "Редактирование визита" : "Новый визит"} onClose={onClose} large>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Дата и время"><input type="datetime-local" value={(form.date || "").slice(0, 16)} onChange={(e) => set("date", e.target.value)} /></Field>
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
          <Field label="Следующий визит"><input type="datetime-local" value={(form.next_visit_date || "").slice(0, 16)} onChange={(e) => set("next_visit_date", e.target.value)} /></Field>
        </div>
        <ModalActions busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function TransactionEditor({ patients, visits, presetPatient, clinicId, onClose, onSaved }) {
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
  const submit = async (event) => {
    event.preventDefault();
    if (Number(form.amount) <= 0) return alert("Введите сумму");
    if (form.type === "Долг" && !form.patient_id) return alert("Для записи долга выберите пациента");
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
          <Field label="Комментарий" full><textarea value={form.comment} onChange={(e) => set("comment", e.target.value)} /></Field>
        </div>
        <ModalActions busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function PhotoUploader({ patient, visits, clinicId, onClose, onSaved }) {
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState("До лечения");
  const [visitId, setVisitId] = useState("");
  const [busy, setBusy] = useState(false);
  const appendFiles = (list) => setFiles((current) => [...current, ...list]);
  const submit = async (event) => {
    event.preventDefault();
    if (!files.length) return alert("Выберите фотографии");
    setBusy(true);
    try { await uploadPhotos(clinicId, patient.id, visitId, category, files); await onSaved(); }
    catch (error) { alert(error.message || "Не удалось добавить фото"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Добавление фото" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Категория"><select value={category} onChange={(e) => setCategory(e.target.value)}>{["До лечения", "Этап лечения", "После лечения", "Рентген / КЛКТ", "Документы", "Другое"].map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Привязать к визиту"><select value={visitId} onChange={(e) => setVisitId(e.target.value)}><option value="">Без привязки</option>{visits.map((v) => <option value={v.id} key={v.id}>{safeDate(v.date)} · {v.visit_kind || "Визит"} · {v.treatment_type}</option>)}</select></Field>
          <label className="upload-zone">
            <Upload />
            <strong>Выбрать из галереи</strong>
            <span>Можно выбрать несколько фото</span>
            <input type="file" accept="image/*" multiple onChange={(e) => appendFiles([...e.target.files])} />
          </label>
          <label className="upload-zone">
            <Camera />
            <strong>Снять на камеру</strong>
            <span>Откроется камера устройства</span>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => appendFiles([...e.target.files])} />
          </label>
          {files.length > 0 && <div className="selected-files full"><Check />Выбрано: {files.length}</div>}
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

function patientFinancials(patientId, data) {
  const visits = data.visits.filter((v) => v.patient_id === patientId);
  const transactions = data.transactions.filter((t) => t.patient_id === patientId);
  const cost = sum(visits, (v) => Number(v.total_cost) - Number(v.discount || 0));
  const visitPaid = sum(visits, (v) => v.paid_amount);
  const unlinkedIncome = sum(transactions.filter((t) => isIncome(t) && !t.visit_id), (t) => t.amount);
  const refunds = sum(visits, (v) => v.refund) + sum(transactions.filter((t) => t.type === "Возврат" && !t.visit_id), (t) => t.amount);
  const expenses = sum(transactions.filter((t) => t.type === "Расход"), (t) => t.amount);
  const manualDebt = sum(transactions.filter(isDebt), (t) => t.amount);
  const paid = visitPaid + unlinkedIncome;
  return { cost, paid, refunds, expenses, manualDebt, debt: Math.max(0, cost - paid + refunds + manualDebt), net: paid - expenses - refunds };
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
