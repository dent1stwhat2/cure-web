import { cloudEnabled, supabase } from "./supabase";

const DEMO_KEY = "cure-demo-v1";

const demoSeed = {
  clinic: { id: "demo-clinic", name: "Клиника CURE", invite_code: "CURE-2026" },
  patients: [
    {
      id: "p1",
      full_name: "Анна Соколова",
      birth_date: "1992-04-12",
      phone: "+7 999 111-22-33",
      status: "На лечении",
      source: "Рекомендации",
      general_note: "Контроль реставрации через две недели.",
      anamnesis: { allergies: "Пенициллин", hypertension: true, anticoagulants: false, contraindications: "" },
      dental: { diagnosis: "Кариес дентина 16", treatment_plan: "Лечение 16, профессиональная гигиена", fdi_teeth: "16" },
      created_at: new Date(Date.now() - 86400000 * 35).toISOString()
    },
    {
      id: "p2",
      full_name: "Михаил Орлов",
      birth_date: "1984-09-23",
      phone: "+7 999 222-33-44",
      status: "Контроль",
      source: "Сайт",
      general_note: "",
      anamnesis: {},
      dental: { diagnosis: "Частичная адентия", treatment_plan: "Ортопедический этап", fdi_teeth: "24, 25" },
      created_at: new Date(Date.now() - 86400000 * 60).toISOString()
    }
  ],
  visits: [
    {
      id: "v1", patient_id: "p1", date: new Date(Date.now() - 86400000 * 4).toISOString(),
      treatment_type: "Лечение кариеса", teeth: "16", diagnosis: "Кариес дентина",
      procedure_description: "Прямая композитная реставрация", total_cost: 25000, paid_amount: 15000,
      discount: 0, refund: 0, materials: "Estelite", anesthesia: "Артикаин", recommendations: "Не принимать пищу 2 часа"
    },
    {
      id: "v2", patient_id: "p2", date: new Date(Date.now() - 86400000 * 12).toISOString(),
      treatment_type: "Консультация", teeth: "24, 25", diagnosis: "Частичная адентия",
      procedure_description: "Осмотр и планирование", total_cost: 5000, paid_amount: 5000,
      discount: 0, refund: 0
    }
  ],
  transactions: [
    { id: "t1", patient_id: "p1", visit_id: "v1", type: "Доход", amount: 15000, category: "Терапия", payment_method: "Карта", date: new Date(Date.now() - 86400000 * 4).toISOString(), comment: "Оплата визита" },
    { id: "t2", patient_id: "p2", visit_id: "v2", type: "Доход", amount: 5000, category: "Консультация", payment_method: "Карта", date: new Date(Date.now() - 86400000 * 12).toISOString(), comment: "" },
    { id: "t3", patient_id: "p1", type: "Расход", amount: 3200, category: "Материалы", payment_method: "Карта", date: new Date(Date.now() - 86400000 * 4).toISOString(), comment: "" },
    { id: "t4", type: "Расход", amount: 12000, category: "Лаборатория", payment_method: "Перевод", date: new Date(Date.now() - 86400000 * 8).toISOString(), comment: "" }
  ],
  photos: [],
  documents: []
};

const readDemo = () => {
  const saved = localStorage.getItem(DEMO_KEY);
  return saved ? JSON.parse(saved) : structuredClone(demoSeed);
};

const writeDemo = (data) => localStorage.setItem(DEMO_KEY, JSON.stringify(data));

export async function loadClinicData(clinicId) {
  if (!cloudEnabled) return readDemo();
  const [clinic, patients, visits, transactions, photos, documents] = await Promise.all([
    supabase.from("clinics").select("*").eq("id", clinicId).single(),
    supabase.from("patients").select("*").eq("clinic_id", clinicId).order("updated_at", { ascending: false }),
    supabase.from("visits").select("*").eq("clinic_id", clinicId).order("date", { ascending: false }),
    supabase.from("finance_transactions").select("*").eq("clinic_id", clinicId).order("date", { ascending: false }),
    supabase.from("photo_records").select("*").eq("clinic_id", clinicId).order("created_at", { ascending: false }),
    supabase.from("patient_documents").select("*").eq("clinic_id", clinicId).order("created_at", { ascending: false })
  ]);
  const error = [clinic, patients, visits, transactions, photos, documents].find((r) => r.error)?.error;
  if (error) throw error;
  const signedPhotos = await Promise.all((photos.data || []).map(async (photo) => {
    const { data } = await supabase.storage.from("clinical-photos").createSignedUrl(photo.storage_path, 3600);
    return { ...photo, signed_url: data?.signedUrl };
  }));
  const signedDocuments = await Promise.all((documents.data || []).map(async (document) => {
    const { data } = await supabase.storage.from("patient-documents").createSignedUrl(document.storage_path, 3600);
    return { ...document, signed_url: data?.signedUrl };
  }));
  return {
    clinic: clinic.data,
    patients: patients.data || [],
    visits: visits.data || [],
    transactions: transactions.data || [],
    photos: signedPhotos,
    documents: signedDocuments
  };
}

export async function savePatient(clinicId, patient) {
  const clean = { ...patient, clinic_id: clinicId, updated_at: new Date().toISOString() };
  delete clean.age;
  if (!cloudEnabled) {
    const data = readDemo();
    const index = data.patients.findIndex((p) => p.id === clean.id);
    if (index >= 0) data.patients[index] = clean;
    else {
      clean.id = crypto.randomUUID();
      clean.created_at = new Date().toISOString();
      data.patients.unshift(clean);
    }
    writeDemo(data);
    return clean;
  }
  const { data, error } = await supabase.from("patients").upsert(clean).select().single();
  if (error) throw error;
  return data;
}

export async function deletePatient(clinicId, patientId, photos = [], documents = []) {
  if (!cloudEnabled) {
    const data = readDemo();
    data.patients = data.patients.filter((p) => p.id !== patientId);
    data.visits = data.visits.filter((v) => v.patient_id !== patientId);
    data.transactions = data.transactions.filter((t) => t.patient_id !== patientId);
    data.photos = data.photos.filter((p) => p.patient_id !== patientId);
    data.documents = (data.documents || []).filter((document) => document.patient_id !== patientId);
    writeDemo(data);
    return;
  }
  const paths = photos.filter((p) => p.patient_id === patientId).map((p) => p.storage_path);
  if (paths.length) await supabase.storage.from("clinical-photos").remove(paths);
  const documentPaths = documents.filter((document) => document.patient_id === patientId).map((document) => document.storage_path);
  if (documentPaths.length) await supabase.storage.from("patient-documents").remove(documentPaths);
  const { error } = await supabase.from("patients").delete().eq("clinic_id", clinicId).eq("id", patientId);
  if (error) throw error;
}

export async function uploadDocuments(clinicId, patientId, category, comment, files) {
  if (!cloudEnabled) {
    const data = readDemo();
    data.documents ||= [];
    for (const file of files) {
      const url = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      data.documents.unshift({
        id: crypto.randomUUID(), patient_id: patientId, category, comment,
        file_name: file.name, mime_type: file.type || "application/octet-stream",
        file_size: file.size, signed_url: url, storage_path: "",
        created_at: new Date().toISOString()
      });
    }
    writeDemo(data);
    return;
  }
  for (const file of files) {
    const extension = file.name.includes(".") ? `.${file.name.split(".").pop().toLowerCase()}` : "";
    const storagePath = `${clinicId}/${patientId}/${crypto.randomUUID()}${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("patient-documents")
      .upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from("patient_documents").insert({
      clinic_id: clinicId, patient_id: patientId, category, comment,
      file_name: file.name, mime_type: file.type || "application/octet-stream",
      file_size: file.size, storage_path: storagePath
    });
    if (error) {
      await supabase.storage.from("patient-documents").remove([storagePath]);
      throw error;
    }
  }
}

export async function deleteDocument(document) {
  if (!cloudEnabled) {
    const data = readDemo();
    data.documents = (data.documents || []).filter((item) => item.id !== document.id);
    writeDemo(data);
    return;
  }
  await supabase.storage.from("patient-documents").remove([document.storage_path]);
  const { error } = await supabase.from("patient_documents").delete().eq("id", document.id);
  if (error) throw error;
}

export async function saveVisit(clinicId, visit) {
  const clean = { ...visit, clinic_id: clinicId, updated_at: new Date().toISOString() };
  if (!cloudEnabled) {
    const data = readDemo();
    const index = data.visits.findIndex((v) => v.id === clean.id);
    if (index >= 0) data.visits[index] = clean;
    else {
      clean.id = crypto.randomUUID();
      clean.created_at = new Date().toISOString();
      data.visits.unshift(clean);
    }
    syncDemoVisitTransaction(data, clean, "Доход", Number(clean.paid_amount || 0), "Оплата визита");
    syncDemoVisitTransaction(data, clean, "Возврат", Number(clean.refund || 0), "Возврат по визиту");
    writeDemo(data);
    return clean;
  }
  const { data, error } = await supabase.from("visits").upsert(clean).select().single();
  if (error) throw error;
  await syncCloudVisitTransaction(clinicId, data, "Доход", Number(data.paid_amount || 0), "Оплата визита");
  await syncCloudVisitTransaction(clinicId, data, "Возврат", Number(data.refund || 0), "Возврат по визиту");
  return data;
}

function syncDemoVisitTransaction(store, visit, type, amount, comment) {
  const index = store.transactions.findIndex((t) => t.visit_id === visit.id && t.type === type && t.comment === comment);
  if (amount <= 0) {
    if (index >= 0) store.transactions.splice(index, 1);
    return;
  }
  const row = {
    id: index >= 0 ? store.transactions[index].id : crypto.randomUUID(),
    patient_id: visit.patient_id, visit_id: visit.id, type, amount,
    category: visit.treatment_type, payment_method: "Карта",
    date: visit.date, comment, created_at: index >= 0 ? store.transactions[index].created_at : new Date().toISOString()
  };
  if (index >= 0) store.transactions[index] = row;
  else store.transactions.unshift(row);
}

async function syncCloudVisitTransaction(clinicId, visit, type, amount, comment) {
  const { data: existing, error: readError } = await supabase
    .from("finance_transactions")
    .select("id")
    .eq("visit_id", visit.id)
    .eq("type", type)
    .eq("comment", comment)
    .maybeSingle();
  if (readError) throw readError;
  if (amount <= 0) {
    if (existing) {
      const { error } = await supabase.from("finance_transactions").delete().eq("id", existing.id);
      if (error) throw error;
    }
    return;
  }
  const row = {
    ...(existing ? { id: existing.id } : {}),
    clinic_id: clinicId, patient_id: visit.patient_id, visit_id: visit.id,
    type, amount, date: visit.date, category: visit.treatment_type,
    payment_method: "Карта", comment
  };
  const { error } = await supabase.from("finance_transactions").upsert(row);
  if (error) throw error;
}

export async function saveTransaction(clinicId, transaction) {
  const clean = { ...transaction, clinic_id: clinicId };
  if (!cloudEnabled) {
    const data = readDemo();
    clean.id ||= crypto.randomUUID();
    clean.created_at ||= new Date().toISOString();
    data.transactions.unshift(clean);
    writeDemo(data);
    return clean;
  }
  const { data, error } = await supabase.from("finance_transactions").upsert(clean).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTransaction(clinicId, id) {
  if (!cloudEnabled) {
    const data = readDemo();
    data.transactions = data.transactions.filter((t) => t.id !== id);
    writeDemo(data);
    return;
  }
  const { error } = await supabase.from("finance_transactions").delete().eq("clinic_id", clinicId).eq("id", id);
  if (error) throw error;
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const max = 2200;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
}

export async function uploadPhotos(clinicId, patientId, visitId, category, files) {
  if (!cloudEnabled) {
    const data = readDemo();
    for (const file of files) {
      const url = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      data.photos.unshift({
        id: crypto.randomUUID(), patient_id: patientId, visit_id: visitId || null,
        category, comment: "", signed_url: url, storage_path: "", created_at: new Date().toISOString()
      });
    }
    writeDemo(data);
    return;
  }
  for (const file of files) {
    const blob = await compressImage(file);
    const name = `${clinicId}/${patientId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("clinical-photos")
      .upload(name, blob, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from("photo_records").insert({
      clinic_id: clinicId, patient_id: patientId, visit_id: visitId || null,
      category, storage_path: name
    });
    if (error) {
      await supabase.storage.from("clinical-photos").remove([name]);
      throw error;
    }
  }
}

export async function updatePhoto(photo) {
  if (!cloudEnabled) {
    const data = readDemo();
    const item = data.photos.find((p) => p.id === photo.id);
    if (item) Object.assign(item, { category: photo.category, comment: photo.comment });
    writeDemo(data);
    return;
  }
  const { error } = await supabase.from("photo_records")
    .update({ category: photo.category, comment: photo.comment })
    .eq("id", photo.id);
  if (error) throw error;
}

export async function deletePhoto(photo) {
  if (!cloudEnabled) {
    const data = readDemo();
    data.photos = data.photos.filter((p) => p.id !== photo.id);
    writeDemo(data);
    return;
  }
  await supabase.storage.from("clinical-photos").remove([photo.storage_path]);
  const { error } = await supabase.from("photo_records").delete().eq("id", photo.id);
  if (error) throw error;
}

export function subscribeToClinic(clinicId, onChange) {
  if (!cloudEnabled) return () => {};
  const channel = supabase.channel(`clinic-${clinicId}`);
  ["patients", "visits", "finance_transactions", "photo_records", "patient_documents"].forEach((table) => {
    channel.on("postgres_changes", {
      event: "*", schema: "public", table, filter: `clinic_id=eq.${clinicId}`
    }, onChange);
  });
  channel.subscribe();
  return () => supabase.removeChannel(channel);
}

export function resetDemo() {
  localStorage.removeItem(DEMO_KEY);
}
