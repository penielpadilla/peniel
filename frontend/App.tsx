import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Building2, Gift, CheckCircle, Camera, Sparkles, Users, 
  Search, Download, Wifi, WifiOff, Send, RefreshCw, 
  ChevronRight, AlertCircle, Briefcase, Mail, Phone, MapPin, Compass 
} from "lucide-react";

import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore, collection, addDoc, onSnapshot, Firestore } from "firebase/firestore";
import { GoogleGenAI, Type, Chat } from "@google/genai";

import { Lead, NotificationState, ChatMessage, MockCard } from "./types";

// Global Environment Variable Parsing with Safe Fallbacks
const appId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : 'cominsa-expo-2026';
const firebaseConfigStr = typeof window !== 'undefined' && window.__firebase_config ? window.__firebase_config : null;
const initialAuthToken = typeof window !== 'undefined' && window.__initial_auth_token ? window.__initial_auth_token : null;

const LINEAS_INTERES = [
  "Bombeo industrial y minero",
  "Ventilación minera",
  "Perforación y exploración",
  "Aire comprimido y generación de energía",
  "Seguridad industrial y rescate minero",
  "Manejo de materiales",
  "Trituración, cribado y procesamiento",
  "Demolición y rompimiento",
  "Minería subterránea",
  "Refacciones y mantenimiento",
  "Ingeniería y soporte técnico",
  "Soluciones ambientales y control de polvo",
  "Instrumentación y monitoreo",
  "Equipos para túneles y construcción pesada"
];

const MOCK_BUSINESS_CARDS: MockCard[] = [
  {
    label: "Ing. Alejandro Gomez - Minera Peñoles",
    nombre: "Alejandro Gómez Ruiz",
    empresa: "Industrias Peñoles S.A.B. de C.V.",
    puesto: "Superintendente de Mantenimiento",
    correo: "a.gomez@penoles.com.mx",
    telefono: "871-729-5500",
    ubicacion: "Torreón, Coahuila",
    unidad: "Planta Fundición Met-Mex",
    proyecto: "Si",
    comentarios: "Requiere cotización urgente de ventilación auxiliar y sistemas de bombeo para la zona de rampas."
  },
  {
    label: "Dra. Sofía Villarreal - Minera Frisco",
    nombre: "Sofía Villarreal Mendoza",
    empresa: "Minera Frisco",
    puesto: "Gerente de Seguridad Industrial",
    correo: "sofia.villarreal@mfrisco.com.mx",
    telefono: "555-624-3200",
    ubicacion: "Zacatecas, Zac.",
    unidad: "Unidad El Coronel",
    proyecto: "Evaluacion",
    comentarios: "Buscando renovación de equipos de rescate minero autónomo y soluciones de monitoreo ambiental."
  }
];

export default function App() {
  // Navigation & UI State
  const [activeTab, setActiveTab] = useState<"register" | "scanner" | "ai_advisor" | "dashboard">("register");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [offlineLeads, setOfflineLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [firebaseInitialized, setFirebaseInitialized] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Form State
  const [form, setForm] = useState<Lead>({
    nombre: "",
    empresa: "",
    puesto: "",
    correo: "",
    telefono: "",
    ubicacion: "",
    unidad: "",
    proyecto: "",
    comentarios: "",
    intereses: []
  });

  // OCR Business Card Scanner State
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [scanningStatus, setScanningStatus] = useState<"idle" | "camera_active" | "upload_ready" | "processing">("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Gemini AI State
  const aiRef = useRef(new GoogleGenAI({ apiKey: process.env.API_KEY || '', vertexai: true }));
  const chatRef = useRef<Chat | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "¡Hola! Bienvenido al stand virtual de COMINSA. Soy tu Asesor AI para Expo Miners 2026. Pregúntame sobre nuestros sistemas de bombeo, ventilación minera, seguridad y rescate, aire comprimido o cualquiera de nuestras soluciones especializadas."
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Dashboard search & filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [filterInterest, setFilterInterest] = useState("all");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Dynamic references
  const dbRef = useRef<Firestore | null>(null);

  // 1. Connection Monitoring
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // 2. Load LocalStorage Fallback initially
  useEffect(() => {
    const stored = localStorage.getItem("cominsa_leads_local");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setOfflineLeads(parsed);
      } catch (e) {
        console.error("Error parsing local storage leads:", e);
      }
    }
  }, []);

  // 3. Setup Firebase
  useEffect(() => {
    let authUnsubscribe: (() => void) | null = null;
    let firestoreUnsubscribe: (() => void) | null = null;

    const setupFirebase = async () => {
      if (!firebaseConfigStr) {
        console.log("No firebase configuration injected. Operating in Local/Offline Mode.");
        setFirebaseInitialized(false);
        return;
      }

      try {
        const config = JSON.parse(firebaseConfigStr);
        const firebaseApp = initializeApp(config);
        const auth = getAuth(firebaseApp);
        const db = getFirestore(firebaseApp);
        dbRef.current = db;

        if (initialAuthToken) {
          await signInWithCustomToken(auth, initialAuthToken);
        } else {
          await signInAnonymously(auth);
        }

        authUnsubscribe = onAuthStateChanged(auth, (user) => {
          setCurrentUser(user);
          if (user) {
            showToast("Conexión segura establecida con COMINSA Cloud", "success");
            
            const collectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'leads');
            
            firestoreUnsubscribe = onSnapshot(
              collectionRef,
              (snapshot) => {
                const items: Lead[] = [];
                snapshot.forEach((doc) => {
                  items.push({ id: doc.id, ...(doc.data() as Lead) });
                });
                items.sort((a, b) => {
                  const tA = a.fecha ? new Date(a.fecha).getTime() : 0;
                  const tB = b.fecha ? new Date(b.fecha).getTime() : 0;
                  return tB - tA;
                });
                setLeads(items);
                setFirebaseInitialized(true);
              },
              (error) => {
                console.error("Firestore listener error:", error);
                showToast("Error de permisos. Ejecutando en base de datos local temporal.", "error");
                setFirebaseInitialized(false);
              }
            );
          } else {
            setLeads([]);
          }
        });

      } catch (err) {
        console.error("Firebase startup failed:", err);
        setFirebaseInitialized(false);
      }
    };

    setupFirebase();

    return () => {
      if (authUnsubscribe) authUnsubscribe();
      if (firestoreUnsubscribe) firestoreUnsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync Offline leads
  useEffect(() => {
    if (!isOnline || !firebaseInitialized || !currentUser || !dbRef.current || offlineLeads.length === 0) return;

    const syncQueue = async () => {
      const remaining = [...offlineLeads];
      const db = dbRef.current;
      if (!db) return;
      
      const leadsCol = collection(db, 'artifacts', appId, 'public', 'data', 'leads');
      
      showToast(`Sincronizando ${remaining.length} registros pendientes...`, "info");
      
      let syncedCount = 0;
      for (let i = 0; i < remaining.length; i++) {
        const item = remaining[i];
        try {
          await addDoc(leadsCol, {
            ...item,
            syncStatus: "synced",
            syncedAt: new Date().toISOString()
          });
          syncedCount++;
        } catch (e) {
          console.error("Failed to sync item:", e);
          break; 
        }
      }

      if (syncedCount > 0) {
        const newRemaining = remaining.slice(syncedCount);
        setOfflineLeads(newRemaining);
        localStorage.setItem("cominsa_leads_local", JSON.stringify(newRemaining));
        if (newRemaining.length === 0) {
          showToast("Todos los registros han sido sincronizados en la nube", "success");
        }
      }
    };

    syncQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, firebaseInitialized, currentUser, offlineLeads.length]);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = "info") => {
    setNotification({ text, type });
    setTimeout(() => {
      setNotification((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const handleInterestChange = (linea: string) => {
    setForm(prev => {
      const intereses = prev.intereses.includes(linea)
        ? prev.intereses.filter(item => item !== linea)
        : [...prev.intereses, linea];
      return { ...prev, intereses };
    });
  };

  const handleSubmitLead = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);

    if (form.intereses.length === 0) {
      showToast("Por favor, seleccione al menos una línea de solución de interés.", "error");
      setLoading(false);
      return;
    }

    const newLead: Lead = {
      ...form,
      fecha: new Date().toISOString(),
      dispositivo: "iPad-ExpoStand",
      registradoPor: currentUser?.uid || "LocalUser"
    };

    let successfullySavedOnline = false;

    if (firebaseInitialized && currentUser && dbRef.current) {
      try {
        const collectionRef = collection(dbRef.current, 'artifacts', appId, 'public', 'data', 'leads');
        await addDoc(collectionRef, {
          ...newLead,
          syncStatus: "synced"
        });
        successfullySavedOnline = true;
      } catch (error) {
        console.error("Cloud storage save failed, falling back to local:", error);
      }
    }

    if (!successfullySavedOnline) {
      const updatedOffline = [...offlineLeads, { ...newLead, syncStatus: "offline_pending" as const }];
      setOfflineLeads(updatedOffline);
      localStorage.setItem("cominsa_leads_local", JSON.stringify(updatedOffline));
      showToast("Guardado localmente. Se sincronizará automáticamente al detectar conexión.", "info");
    } else {
      showToast("¡Registro cargado exitosamente en la nube COMINSA!", "success");
    }

    setSuccess(true);
    setLoading(false);

    setForm({
      nombre: "",
      empresa: "",
      puesto: "",
      correo: "",
      telefono: "",
      ubicacion: "",
      unidad: "",
      proyecto: "",
      comentarios: "",
      intereses: []
    });

    setTimeout(() => {
      setSuccess(false);
    }, 4500);
  };

  const handleExportCSV = () => {
    const allLeads = [...offlineLeads, ...leads];
    if (allLeads.length === 0) {
      showToast("No hay registros para exportar aún.", "info");
      return;
    }

    const headers = [
      "Fecha", "Nombre completo", "Empresa", "Puesto", "Correo electrónico", 
      "Teléfono", "Ciudad/Estado", "Unidad/Planta", "Proyecto Activo", 
      "Intereses", "Comentarios", "Estado de Sync"
    ];

    const rows = allLeads.map(lead => [
      lead.fecha ? new Date(lead.fecha).toLocaleString() : "",
      lead.nombre || "",
      lead.empresa || "",
      lead.puesto || "",
      lead.correo || "",
      lead.telefono || "",
      lead.ubicacion || "",
      lead.unidad || "",
      lead.proyecto || "",
      (lead.intereses || []).join(" | "),
      (lead.comentarios || "").replace(/\n/g, " "),
      lead.syncStatus || "synced"
    ]);

    const csvContent = "﻿" + [
      headers.join(","),
      ...rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `leads_cominsa_expominers_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Reporte de leads descargado exitosamente", "success");
  };

  const startCamera = async () => {
    setScanningStatus("camera_active");
    setCapturedImage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" } 
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.error("Camera access failed, fallback to file upload:", err);
      showToast("No se detectó cámara física. Carga el archivo de imagen directamente.", "info");
      setScanningStatus("upload_ready");
    }
  };

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  }, [cameraStream]);

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg");
        setCapturedImage(dataUrl);
        stopCamera();
        setScanningStatus("upload_ready");
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setCapturedImage(event.target.result as string);
          setScanningStatus("upload_ready");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const processBusinessCardOCR = async () => {
    if (!capturedImage) return;
    setScanningStatus("processing");
    
    const base64Data = capturedImage.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const promptText = `Eres un sistema OCR industrial especializado para el stand de COMINSA en Expo Miners.
Analiza la tarjeta de presentación en la imagen. Extrae con precisión toda la información de contacto disponible.
Debes devolver la información formateada en una respuesta JSON válida. No agregues formatos de bloque Markdown o explicaciones, solo el objeto JSON crudo.
Si un campo no es identificable, déjalo vacío ("").`;

    try {
      const response = await aiRef.current.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: promptText },
              { inlineData: { mimeType: "image/jpeg", data: base64Data } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              nombre: { type: Type.STRING },
              empresa: { type: Type.STRING },
              puesto: { type: Type.STRING },
              correo: { type: Type.STRING },
              telefono: { type: Type.STRING },
              ubicacion: { type: Type.STRING },
              unidad: { type: Type.STRING }
            }
          }
        }
      });

      if (response.text) {
        const extracted = JSON.parse(response.text);
        
        setForm(prev => ({
          ...prev,
          nombre: extracted.nombre || prev.nombre,
          empresa: extracted.empresa || prev.empresa,
          puesto: extracted.puesto || prev.puesto,
          correo: extracted.correo || prev.correo,
          telefono: extracted.telefono || prev.telefono,
          ubicacion: extracted.ubicacion || prev.ubicacion,
          unidad: extracted.unidad || prev.unidad,
          comentarios: prev.comentarios + (prev.comentarios ? "\n" : "") + "[Información extraída mediante scanner de tarjeta]"
        }));

        showToast("Tarjeta escaneada con éxito. Datos cargados en el formulario.", "success");
        setActiveTab("register");
      } else {
        throw new Error("No text in response");
      }
    } catch (error) {
      console.error("Gemini Vision OCR Error, using mock card solver:", error);
      showToast("Falla de red o límite de API. Usando simulación de datos para demostración del iPad.", "info");
      
      const randomMock = MOCK_BUSINESS_CARDS[Math.floor(Math.random() * MOCK_BUSINESS_CARDS.length)];
      setForm(prev => ({
        ...prev,
        ...randomMock,
        intereses: ["Bombeo industrial y minero", "Ventilación minera"],
        comentarios: "[Modo Simulación Activo] " + randomMock.comentarios
      }));
      setActiveTab("register");
    } finally {
      setScanningStatus("idle");
    }
  };

  const handleSimulateQuickMock = (mockItem: MockCard) => {
    setForm(prev => ({
      ...prev,
      ...mockItem,
      intereses: ["Bombeo industrial y minero", "Ventilación minera", "Seguridad industrial y rescate minero"]
    }));
    showToast("Formulario pre-cargado con datos de demostración", "info");
    setActiveTab("register");
  };

  const handleSendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const userText = chatInput.trim();
    setChatMessages(prev => [...prev, { role: "user", content: userText }]);
    setChatInput("");
    setChatLoading(true);

    const systemPrompt = `Eres el "Asesor de Soluciones Industriales COMINSA", un ingeniero experto y dinámico asignado al stand de COMINSA en EXPO MINERS 2026.
Tu objetivo es dar respuestas profesionales, amigables, cortas y persuasivas sobre los servicios de COMINSA.
COMINSA se especializa en las siguientes áreas técnicas:
1. Bombeo industrial y minero
2. Ventilación minera
3. Perforación y exploración
4. Aire comprimido y generación de energía
5. Seguridad industrial y rescate minero
6. Manejo de materiales
7. Trituración, cribado y procesamiento
8. Demolición y rompimiento
9. Minería subterránea
10. Refacciones y mantenimiento
11. Ingeniería y soporte técnico
12. Soluciones ambientales y control de polvo
13. Instrumentación y monitoreo
14. Equipos para túneles y construcción pesada

Mantén tus respuestas breves (máximo 4-5 líneas por respuesta) porque el visitante está de pie en una tablet en medio del stand. Si el usuario muestra fuerte interés, recuérdale registrarse en el stand para obtener su souvenir oficial y cotización prioritaria.`;

    try {
      if (!chatRef.current) {
        chatRef.current = aiRef.current.chats.create({
          model: 'gemini-2.5-flash',
          config: {
            systemInstruction: systemPrompt
          }
        });
      }

      const response = await chatRef.current.sendMessage({ message: userText });
      
      if (response.text) {
        setChatMessages(prev => [...prev, { role: "assistant", content: response.text }]);
      } else {
        throw new Error("Empty AI Response");
      }
    } catch (error) {
      console.error("Gemini Chat Error:", error);
      setChatMessages(prev => [...prev, { 
        role: "assistant", 
        content: "Estimado ingeniero, de momento tengo una interferencia en la red local de la mina. Sin embargo, nuestro equipo de soporte de COMINSA está listo en el stand para asesorarle con cualquiera de nuestras soluciones de bombeo, ventilación o refacciones." 
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const totalLeads = offlineLeads.length + leads.length;
  
  const interestMetrics = () => {
    const metrics: Record<string, number> = {};
    LINEAS_INTERES.forEach(linea => {
      metrics[linea] = 0;
    });

    const combined = [...offlineLeads, ...leads];
    combined.forEach(l => {
      const interests = l.intereses || [];
      interests.forEach(interest => {
        if (metrics[interest] !== undefined) {
          metrics[interest]++;
        }
      });
    });
    return metrics;
  };

  const metrics = interestMetrics();

  const getTopInterests = () => {
    return Object.entries(metrics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  };

  const topInterests = getTopInterests();

  const getFilteredLeads = () => {
    const combined = [...offlineLeads, ...leads];
    return combined.filter(l => {
      const matchesSearch = 
        (l.nombre || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.empresa || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.unidad || "").toLowerCase().includes(searchTerm.toLowerCase());
      
      if (filterInterest === "all") return matchesSearch;
      return matchesSearch && (l.intereses || []).includes(filterInterest);
    });
  };

  const filteredLeads = getFilteredLeads();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-amber-500 selection:text-black">
      <header className="sticky top-0 z-40 bg-zinc-900/90 border-b border-zinc-800 backdrop-blur-md px-4 py-4 md:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="bg-gradient-to-br from-amber-400 to-amber-600 text-black p-3 rounded-2xl shadow-lg flex items-center justify-center">
            <Building2 className="w-8 h-8 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-white font-mono">COMINSA</h1>
              <span className="bg-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                PROCESOS MINEROS
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-semibold tracking-wider uppercase">
              Expo Miners 2026 • Registro & Soluciones AI
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <div className="flex items-center gap-2 bg-zinc-800/60 px-3 py-1.5 rounded-xl border border-zinc-700/50 text-xs">
            {isOnline ? (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <Wifi className="w-4.5 h-4.5 animate-pulse" /> Online
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-rose-400">
                <WifiOff className="w-4.5 h-4.5" /> Stand Offline
              </span>
            )}
            <span className="text-zinc-500">|</span>
            <span className="text-zinc-300 font-semibold">
              {firebaseInitialized ? "Cloud Sync Activo" : "Modo Local"}
            </span>
          </div>

          <div className="bg-zinc-800/80 px-4 py-1.5 rounded-xl border border-zinc-700 flex items-center gap-2">
            <span className="text-xs text-zinc-400">Registros:</span>
            <span className="text-lg font-black text-amber-400">{totalLeads}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <nav className="lg:col-span-3 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-3 lg:pb-0 scrollbar-none">
          <button
            onClick={() => { setActiveTab("register"); stopCamera(); }}
            className={`flex items-center gap-3 w-full px-5 py-4 rounded-2xl font-bold transition-all shrink-0 text-left ${
              activeTab === "register"
                ? "bg-gradient-to-r from-amber-500 to-amber-600 text-black shadow-lg shadow-amber-500/15 scale-[1.02]"
                : "bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-300 border border-zinc-800/80"
            }`}
          >
            <Gift className="w-5.5 h-5.5" />
            <div className="flex-1">
              <p className="text-sm">Registro de Leads</p>
              <p className={`text-[10px] ${activeTab === 'register' ? 'text-black/70' : 'text-zinc-500'}`}>Captura de visitantes</p>
            </div>
          </button>

          <button
            onClick={() => { setActiveTab("scanner"); startCamera(); }}
            className={`flex items-center gap-3 w-full px-5 py-4 rounded-2xl font-bold transition-all shrink-0 text-left ${
              activeTab === "scanner"
                ? "bg-gradient-to-r from-amber-500 to-amber-600 text-black shadow-lg shadow-amber-500/15 scale-[1.02]"
                : "bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-300 border border-zinc-800/80"
            }`}
          >
            <Camera className="w-5.5 h-5.5" />
            <div className="flex-1">
              <p className="text-sm">Escáner de Tarjetas</p>
              <p className={`text-[10px] ${activeTab === 'scanner' ? 'text-black/70' : 'text-zinc-500'}`}>OCR Inteligente Gemini</p>
            </div>
          </button>

          <button
            onClick={() => { setActiveTab("ai_advisor"); stopCamera(); }}
            className={`flex items-center gap-3 w-full px-5 py-4 rounded-2xl font-bold transition-all shrink-0 text-left ${
              activeTab === "ai_advisor"
                ? "bg-gradient-to-r from-amber-500 to-amber-600 text-black shadow-lg shadow-amber-500/15 scale-[1.02]"
                : "bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-300 border border-zinc-800/80"
            }`}
          >
            <Sparkles className="w-5.5 h-5.5" />
            <div className="flex-1">
              <p className="text-sm">Asesor Industrial AI</p>
              <p className={`text-[10px] ${activeTab === 'ai_advisor' ? 'text-black/70' : 'text-zinc-500'}`}>Consultas rápidas</p>
            </div>
          </button>

          <button
            onClick={() => { setActiveTab("dashboard"); stopCamera(); }}
            className={`flex items-center gap-3 w-full px-5 py-4 rounded-2xl font-bold transition-all shrink-0 text-left ${
              activeTab === "dashboard"
                ? "bg-gradient-to-r from-amber-500 to-amber-600 text-black shadow-lg shadow-amber-500/15 scale-[1.02]"
                : "bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-300 border border-zinc-800/80"
            }`}
          >
            <Users className="w-5.5 h-5.5" />
            <div className="flex-1">
              <p className="text-sm">Dashboard Stand</p>
              <p className={`text-[10px] ${activeTab === 'dashboard' ? 'text-black/70' : 'text-zinc-500'}`}>Control en tiempo real</p>
            </div>
          </button>

          <div className="hidden lg:block bg-zinc-900/40 border border-zinc-800/60 rounded-2xl p-4 mt-6">
            <h4 className="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">Info Dispositivo</h4>
            <div className="space-y-2 text-xs text-zinc-500">
              <p className="flex justify-between">
                <span>UID Stand:</span> 
                <span className="font-mono text-[10px] text-zinc-300 select-all max-w-[110px] truncate" title={currentUser?.uid || "Local mode"}>
                  {currentUser?.uid || "Modo offline"}
                </span>
              </p>
              <p className="flex justify-between">
                <span>Pendientes Sync:</span> 
                <span className={`font-bold ${offlineLeads.length > 0 ? "text-amber-400 animate-pulse" : "text-zinc-400"}`}>
                  {offlineLeads.length}
                </span>
              </p>
              <p className="flex justify-between">
                <span>Evento:</span> 
                <span className="text-zinc-300">EXPO MINERS 2026</span>
              </p>
            </div>
          </div>
        </nav>

        <section className="lg:col-span-9 flex flex-col gap-6">
          
          {notification && (
            <div className={`p-4 rounded-xl flex items-center justify-between border animate-in fade-in slide-in-from-top-4 ${
              notification.type === "success" 
                ? "bg-emerald-950/40 text-emerald-300 border-emerald-500/30" 
                : notification.type === "error" 
                ? "bg-rose-950/40 text-rose-300 border-rose-500/30" 
                : "bg-blue-950/40 text-blue-300 border-blue-500/30"
            }`}>
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5.5 h-5.5 shrink-0" />
                <p className="text-sm font-semibold">{notification.text}</p>
              </div>
              <button 
                onClick={() => setNotification(null)}
                className="text-xs hover:underline uppercase text-zinc-400 px-2 py-1 font-bold"
              >
                Cerrar
              </button>
            </div>
          )}

          {activeTab === "register" && (
            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-[28px] overflow-hidden backdrop-blur-xl">
              
              <div className="bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700 text-black px-6 py-8 md:p-10 relative overflow-hidden">
                <div className="absolute right-0 top-0 bottom-0 opacity-10 pointer-events-none">
                  <Building2 className="w-96 h-96 -mr-16 -mt-16" />
                </div>
                <div className="relative z-10">
                  <div className="inline-flex items-center gap-2 bg-black text-amber-400 font-black text-xs px-3.5 py-1.5 rounded-full mb-4 shadow-lg border border-amber-400/20">
                    <Gift className="w-4 h-4" />
                    REGÍSTRATE Y OBTIENE TU SOUVENIR EXCLUSIVO
                  </div>
                  <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
                    Bienvenido a COMINSA
                  </h2>
                  <p className="text-zinc-900 font-medium text-sm md:text-base mt-2 max-w-2xl">
                    Registre su información técnica para recibir una muestra y mantenerse informado sobre nuestras soluciones integrales de bombeo, ventilación, seguridad y soporte de procesos.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmitLead} className="p-6 md:p-8 space-y-8">
                
                <div className="flex items-center justify-between text-xs text-zinc-400 border-b border-zinc-800 pb-4">
                  <span className="font-semibold text-zinc-300">Campos del Formulario</span>
                  <span className="text-amber-500 font-bold">Todos los campos con * son obligatorios</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                      Nombre completo <span className="text-amber-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={form.nombre}
                      onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                      placeholder="Ingresa nombre y apellido"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                      Empresa / Compañía <span className="text-amber-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={form.empresa}
                      onChange={(e) => setForm({ ...form, empresa: e.target.value })}
                      placeholder="Nombre de la empresa minera/contratista"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                      Correo electrónico <span className="text-amber-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={form.correo}
                      onChange={(e) => setForm({ ...form, correo: e.target.value })}
                      placeholder="ejemplo@minera.com"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                      Teléfono de contacto
                    </label>
                    <input
                      type="tel"
                      value={form.telefono}
                      onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                      placeholder="Código de área + Número"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                      Puesto / Cargo
                    </label>
                    <input
                      type="text"
                      value={form.puesto}
                      onChange={(e) => setForm({ ...form, puesto: e.target.value })}
                      placeholder="Ej. Superintendente / Gerente de Planta"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                      Ciudad / Estado
                    </label>
                    <input
                      type="text"
                      value={form.ubicacion}
                      onChange={(e) => setForm({ ...form, ubicacion: e.target.value })}
                      placeholder="Ej: Cananea, Sonora"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                      Unidad minera o planta industrial
                    </label>
                    <input
                      type="text"
                      value={form.unidad}
                      onChange={(e) => setForm({ ...form, unidad: e.target.value })}
                      placeholder="Ej. Unidad Buenavista del Cobre / Mina Peñasquito"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                    />
                  </div>
                </div>

                <div className="border-t border-zinc-800 pt-6">
                  <label className="block text-xs font-bold text-zinc-300 mb-3 uppercase tracking-wide">
                    Líneas de Solución e Interés <span className="text-amber-500">*</span>
                  </label>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {LINEAS_INTERES.map((linea, idx) => {
                      const isChecked = form.intereses.includes(linea);
                      return (
                        <label key={idx} className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all cursor-pointer ${
                          isChecked 
                            ? "bg-amber-500/10 border-amber-500/50 text-white" 
                            : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                        }`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleInterestChange(linea)}
                            className="mt-1 h-4 w-4 rounded border-zinc-700 text-amber-500 focus:ring-amber-500 bg-zinc-900"
                          />
                          <div>
                            <p className="text-sm font-bold text-white leading-tight">{linea}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-zinc-800 pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                      ¿Cuenta con algún proyecto activo?
                    </label>
                    <select
                      value={form.proyecto}
                      onChange={(e) => setForm({ ...form, proyecto: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-all text-sm"
                    >
                      <option value="">Seleccione una opción</option>
                      <option value="Si">Sí (Urgente - menos de 3 meses)</option>
                      <option value="No">No por el momento</option>
                      <option value="Evaluacion">En evaluación presupuestaria</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                      Tip para Expositor
                    </label>
                    <div className="bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 p-3.5 rounded-xl leading-relaxed flex items-start gap-2">
                      <span className="text-amber-400 font-extrabold">💡</span>
                      <span>Puedes escanear rápidamente la tarjeta de presentación física del visitante usando la pestaña <strong>Escáner de Tarjetas</strong> para auto-rellenar estos datos.</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wide">
                    Especificaciones / Requerimientos Especiales
                  </label>
                  <textarea
                    rows={4}
                    value={form.comentarios}
                    onChange={(e) => setForm({ ...form, comentarios: e.target.value })}
                    placeholder="Detalla dimensiones de equipos, tipo de mina (tajo/subterránea), o requerimientos del souvenir..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                  />
                </div>

                <div className="border-t border-zinc-800 pt-6">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-amber-400 to-amber-500 text-black py-4 rounded-xl font-extrabold hover:from-amber-500 hover:to-amber-600 transition-all text-lg shadow-lg shadow-amber-500/20 active:scale-[0.99] flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-6 h-6 animate-spin" />
                        Guardando Registro...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-6 h-6" />
                        Completar Registro y Entregar Souvenir
                      </>
                    )}
                  </button>
                </div>
              </form>

              {success && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6 animate-in fade-in">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-8 md:p-10 text-center max-w-md w-full shadow-2xl relative overflow-hidden">
                    
                    <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500" />
                    
                    <div className="flex justify-center mb-6">
                      <div className="bg-emerald-500/10 border border-emerald-500/30 p-5 rounded-full animate-bounce">
                        <CheckCircle className="w-16 h-16 text-emerald-400" />
                      </div>
                    </div>

                    <h3 className="text-3xl font-black text-white mb-2">
                      ¡Registro Exitoso!
                    </h3>
                    <p className="text-zinc-400 text-sm md:text-base mb-6">
                      La información de contacto ha sido sincronizada de manera segura.
                    </p>

                    <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-zinc-950 rounded-2xl p-4 font-bold shadow-lg">
                      🎁 ¡ENTREGA EL SOUVENIR OFICIAL COMINSA!
                    </div>

                    <button
                      onClick={() => setSuccess(false)}
                      className="mt-6 text-zinc-400 hover:text-white font-bold text-xs uppercase tracking-wider"
                    >
                      Siguiente Registro
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "scanner" && (
            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-[28px] p-6 md:p-8 backdrop-blur-xl space-y-6">
              
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
                <div>
                  <h2 className="text-2xl font-black text-white flex items-center gap-2">
                    <Camera className="text-amber-400" /> Escáner de Tarjetas de Presentación
                  </h2>
                  <p className="text-zinc-400 text-sm mt-1">
                    Capture o cargue una tarjeta para extraer la información al instante con inteligencia artificial Gemini.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={startCamera}
                    className="bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs px-4 py-2 rounded-xl border border-zinc-700/60"
                  >
                    Encender Cámara
                  </button>
                </div>
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl">
                <p className="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wide flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Simulación de Tarjeta (Demostración Rápida)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MOCK_BUSINESS_CARDS.map((card, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSimulateQuickMock(card)}
                      className="text-left bg-zinc-950/80 hover:bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/80 text-xs text-zinc-300 transition-all flex items-center justify-between group"
                    >
                      <span className="truncate">{card.label}</span>
                      <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-amber-400" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                
                <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden aspect-video relative flex flex-col justify-center items-center">
                  
                  {scanningStatus === "camera_active" && (
                    <div className="w-full h-full relative">
                      <video 
                        ref={videoRef}
                        className="w-full h-full object-cover"
                        playsInline
                      />
                      
                      <div className="absolute left-0 right-0 h-0.5 bg-emerald-400 opacity-80 animate-pulse shadow-[0_0_8px_rgba(52,211,153,1)]" style={{
                        animation: 'bounce 2s infinite'
                      }} />
                      
                      <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                        <button
                          type="button"
                          onClick={capturePhoto}
                          className="bg-red-500 hover:bg-red-600 text-white p-4 rounded-full shadow-lg border-4 border-white transform hover:scale-105 transition-all"
                        >
                          <div className="w-4 h-4 bg-white rounded-full" />
                        </button>
                      </div>
                    </div>
                  )}

                  {scanningStatus === "upload_ready" && capturedImage && (
                    <div className="w-full h-full relative flex items-center justify-center bg-black">
                      <img 
                        src={capturedImage} 
                        alt="Captured business card" 
                        className="max-h-full object-contain"
                      />
                      <button
                        type="button"
                        onClick={() => { setCapturedImage(null); startCamera(); }}
                        className="absolute top-4 right-4 bg-zinc-900/80 hover:bg-zinc-950 text-white p-2 rounded-xl text-xs font-bold"
                      >
                        Volver a Tomar
                      </button>
                    </div>
                  )}

                  {scanningStatus === "processing" && (
                    <div className="text-center p-6 space-y-4">
                      <RefreshCw className="w-12 h-12 text-amber-500 animate-spin mx-auto" />
                      <p className="text-sm font-bold text-zinc-300">Extrayendo Datos con IA Gemini...</p>
                      <p className="text-xs text-zinc-500 max-w-xs">Analizando logotipos, teléfonos, correos y cargos mineros.</p>
                    </div>
                  )}

                  {scanningStatus === "idle" && !capturedImage && (
                    <div className="text-center p-6 space-y-4">
                      <Camera className="w-12 h-12 text-zinc-600 mx-auto" />
                      <p className="text-xs text-zinc-400 max-w-xs">Utiliza la cámara integrada del iPad o selecciona una imagen de la galería de fotos.</p>
                    </div>
                  )}

                  <canvas ref={canvasRef} className="hidden" />
                </div>

                <div className="space-y-6">
                  <div className="bg-zinc-900/40 p-4 rounded-xl border border-zinc-800 space-y-4">
                    <p className="text-sm font-semibold text-zinc-300">Cargar desde Archivo</p>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="block w-full text-xs text-zinc-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-white hover:file:bg-zinc-700"
                    />
                  </div>

                  {capturedImage && scanningStatus !== "processing" && (
                    <button
                      onClick={processBusinessCardOCR}
                      className="w-full bg-gradient-to-r from-amber-400 to-amber-500 text-black font-extrabold py-4 rounded-xl transition-all hover:from-amber-500 hover:to-amber-600 flex items-center justify-center gap-2 shadow-lg"
                    >
                      <Sparkles className="w-5 h-5" /> Analizar con Gemini OCR
                    </button>
                  )}

                  <div className="bg-zinc-900/20 p-4 rounded-xl border border-zinc-800/60 text-xs text-zinc-500 space-y-2">
                    <p className="font-bold text-zinc-400">¿Cómo funciona?</p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Encuadre la tarjeta de forma horizontal y nítida.</li>
                      <li>Tome la fotografía o cargue el archivo desde su carrete.</li>
                      <li>La IA procesará la imagen y auto-rellenará el formulario para que solo tenga que validarlo.</li>
                    </ol>
                  </div>
                </div>

              </div>
            </div>
          )}

          {activeTab === "ai_advisor" && (
            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-[28px] overflow-hidden backdrop-blur-xl flex flex-col h-[580px]">
              
              <div className="bg-zinc-900 border-b border-zinc-800 p-5 flex items-center gap-3">
                <div className="bg-amber-500 text-black p-2.5 rounded-xl">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Asesor AI de Soluciones COMINSA</h3>
                  <p className="text-zinc-500 text-xs">Soporte en bombeo, ventilación y servicios técnicos</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-zinc-950/40">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 max-w-[85%] ${
                      msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                    }`}
                  >
                    <div className={`p-2 rounded-lg shrink-0 ${
                      msg.role === "user" ? "bg-zinc-800 text-zinc-400" : "bg-amber-500 text-black"
                    }`}>
                      {msg.role === "user" ? <Users className="w-4.5 h-4.5" /> : <Building2 className="w-4.5 h-4.5" />}
                    </div>

                    <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                      msg.role === "user" 
                        ? "bg-zinc-800 text-white rounded-tr-none" 
                        : "bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-none"
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mr-auto p-4">
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
                    <span>COMINSA AI está analizando las especificaciones...</span>
                  </div>
                )}
              </div>

              <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendChatMessage(); }}
                  placeholder="Ej: ¿Qué soluciones de ventilación minera subterránea ofrecen?"
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={handleSendChatMessage}
                  className="bg-amber-500 hover:bg-amber-600 text-black p-3.5 rounded-xl font-bold transition-all shadow-md shrink-0"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>

            </div>
          )}

          {activeTab === "dashboard" && (
            <div className="space-y-6">
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                
                <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Total Capturas</p>
                  <p className="text-3xl font-black text-white mt-1">{totalLeads}</p>
                </div>

                {topInterests.map(([interestName, countValue], idx) => (
                  <div key={idx} className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold truncate" title={interestName}>
                      {interestName}
                    </p>
                    <p className="text-3xl font-black text-amber-400 mt-1">{countValue}</p>
                  </div>
                ))}

                {topInterests.length < 3 && Array.from({ length: 3 - topInterests.length }).map((_, idx) => (
                  <div key={`empty-${idx}`} className="bg-zinc-900/10 border border-zinc-800/40 rounded-2xl p-4 opacity-50">
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-bold">Métrica vacía</p>
                    <p className="text-3xl font-black text-zinc-700 mt-1">0</p>
                  </div>
                ))}
              </div>

              <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-[28px] overflow-hidden backdrop-blur-xl p-6 space-y-6">
                
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
                  <div>
                    <h3 className="text-lg font-bold text-white">Consola de Control del Stand</h3>
                    <p className="text-xs text-zinc-500">Monitoreo y exportación directa de contactos de negocios.</p>
                  </div>

                  <button
                    onClick={handleExportCSV}
                    className="w-full md:w-auto bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-all"
                  >
                    <Download className="w-4.5 h-4.5 text-amber-400" /> Exportar Reporte (CSV)
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-8 relative">
                    <Search className="w-4.5 h-4.5 text-zinc-600 absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Buscar por nombre, empresa o unidad minera..."
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none"
                    />
                  </div>

                  <div className="md:col-span-4">
                    <select
                      value={filterInterest}
                      onChange={(e) => setFilterInterest(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-3 text-sm text-white focus:outline-none"
                    >
                      <option value="all">Todas las líneas</option>
                      {LINEAS_INTERES.map((linea, idx) => (
                        <option key={idx} value={linea}>{linea}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-zinc-800/80 bg-zinc-950/60">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 uppercase tracking-wider font-semibold">
                        <th className="p-4">Contacto</th>
                        <th className="p-4">Empresa / Mina</th>
                        <th className="p-4">Líneas de Interés</th>
                        <th className="p-4">Estatus Sync</th>
                        <th className="p-4 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                      {filteredLeads.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-zinc-600">
                            No se encontraron leads registrados que cumplan con la búsqueda.
                          </td>
                        </tr>
                      ) : (
                        filteredLeads.map((lead, idx) => (
                          <tr key={lead.id || idx} className="hover:bg-zinc-900/40 transition-colors">
                            <td className="p-4">
                              <p className="font-bold text-white text-sm">{lead.nombre}</p>
                              <p className="text-zinc-500 font-mono mt-0.5">{lead.correo}</p>
                            </td>
                            <td className="p-4">
                              <p className="font-semibold text-zinc-300">{lead.empresa}</p>
                              <p className="text-zinc-500 mt-0.5">{lead.unidad || "N/A"}</p>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-wrap gap-1">
                                {(lead.intereses || []).map((interest, i) => (
                                  <span 
                                    key={i}
                                    className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded"
                                  >
                                    {interest}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-4">
                              {lead.syncStatus === "synced" ? (
                                <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                                  <Wifi className="w-3.5 h-3.5" /> Sincronizado
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-500 font-semibold animate-pulse">
                                  <WifiOff className="w-3.5 h-3.5" /> En espera
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              <button
                                onClick={() => setSelectedLead(lead)}
                                className="bg-zinc-800 hover:bg-zinc-700 text-white px-2.5 py-1.5 rounded-lg font-bold"
                              >
                                Ver Detalle
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

              </div>

              {selectedLead && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6 animate-in fade-in">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-6 relative shadow-2xl">
                    
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                      <div>
                        <h4 className="text-lg font-black text-white">{selectedLead.nombre}</h4>
                        <p className="text-zinc-500 text-xs font-semibold uppercase mt-0.5 tracking-wider">
                          Ficha de Lead Técnica
                        </p>
                      </div>
                      <button 
                        onClick={() => setSelectedLead(null)}
                        className="text-zinc-400 hover:text-white font-black text-lg p-2"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="space-y-1">
                        <p className="text-zinc-500 text-xs uppercase font-bold">Empresa</p>
                        <p className="text-zinc-200 font-semibold flex items-center gap-1.5">
                          <Building2 className="w-4 h-4 text-amber-400" /> {selectedLead.empresa}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <p className="text-zinc-500 text-xs uppercase font-bold">Cargo / Puesto</p>
                        <p className="text-zinc-200 font-semibold flex items-center gap-1.5">
                          <Briefcase className="w-4 h-4 text-amber-400" /> {selectedLead.puesto || "N/A"}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <p className="text-zinc-500 text-xs uppercase font-bold">Correo Electrónico</p>
                        <p className="text-zinc-200 font-mono flex items-center gap-1.5">
                          <Mail className="w-4 h-4 text-amber-400" /> {selectedLead.correo}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <p className="text-zinc-500 text-xs uppercase font-bold">Teléfono de Contacto</p>
                        <p className="text-zinc-200 font-mono flex items-center gap-1.5">
                          <Phone className="w-4 h-4 text-amber-400" /> {selectedLead.telefono || "N/A"}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <p className="text-zinc-500 text-xs uppercase font-bold">Ciudad / Estado</p>
                        <p className="text-zinc-200 font-semibold flex items-center gap-1.5">
                          <MapPin className="w-4 h-4 text-amber-400" /> {selectedLead.ubicacion || "N/A"}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <p className="text-zinc-500 text-xs uppercase font-bold">Unidad Minera o Planta</p>
                        <p className="text-zinc-200 font-semibold flex items-center gap-1.5">
                          <Compass className="w-4 h-4 text-amber-400" /> {selectedLead.unidad || "N/A"}
                        </p>
                      </div>
                    </div>

                    <div className="bg-zinc-950 p-4 rounded-xl space-y-2 border border-zinc-800">
                      <p className="text-zinc-500 text-xs uppercase font-bold">Intereses Seleccionados</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {(selectedLead.intereses || []).map((int, i) => (
                          <span key={i} className="bg-amber-500 text-zinc-950 text-xs font-extrabold px-3 py-1 rounded-full">
                            {int}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-zinc-500 text-xs uppercase font-bold">Requerimientos o Comentarios</p>
                      <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 text-zinc-300 text-sm whitespace-pre-wrap leading-relaxed">
                        {selectedLead.comentarios || "Sin comentarios adicionales registrados."}
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-zinc-500 border-t border-zinc-800 pt-4">
                      <span>Registrado el: {selectedLead.fecha ? new Date(selectedLead.fecha).toLocaleString() : "N/A"}</span>
                      <span>Disp: {selectedLead.dispositivo}</span>
                    </div>

                  </div>
                </div>
              )}

            </div>
          )}

        </section>
      </main>

      <footer className="bg-zinc-950 border-t border-zinc-900 py-6 text-center text-xs text-zinc-500 mt-10 space-y-2">
        <p>© 2026 COMINSA. Todos los derechos reservados.</p>
        <p className="text-[10px] text-zinc-600">
          Soluciones de Ingeniería Industrial & Procesos Mineros • Certificación ISO-9001
        </p>
      </footer>
    </div>
  );
}
