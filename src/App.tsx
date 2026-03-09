import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send,
  Mic,
  Paperclip,
  Phone,
  MoreVertical,
  Camera,
  Image as ImageIcon,
  Play,
  Pause,
  X,
  Volume2,
  VolumeX,
  PhoneOff,
  User,
  Sparkles,
  RefreshCw,
  Download
} from 'lucide-react';
import Markdown from 'react-markdown';
import { chatWithAnu, generateAnuVoice, generateAnuImage } from './services/geminiService';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  AUDIO = 'audio',
  CALL = 'call'
}

export interface Message {
  id: number;
  role: 'user' | 'model';
  content: string;
  type: MessageType;
  file_url?: string;
  audio_url?: string;
  timestamp: string;
}

const AudioPlayer = ({ src, text, isModel }: { src?: string, text?: string, isModel: boolean }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = () => {
    if (src && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(e => console.error("Playback failed:", e));
      }
      setIsPlaying(!isPlaying);
    } else if (text) {
      if (isPlaying) {
        window.speechSynthesis.cancel();
        setIsPlaying(false);
      } else {
        setIsPlaying(true);
        playAnuVoice(text, () => setIsPlaying(false));
      }
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    const updateProgress = () => {
      setProgress((audio.currentTime / audio.duration) * 100);
    };

    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('ended', onEnded);
    };
  }, [src]);

  return (
    <div className={`mt-2 flex items-center gap-2 p-2 rounded-full border ${isModel ? 'bg-glow/10 border-glow/30' : 'bg-white/10 border-white/20'}`}>
      <button
        onClick={togglePlay}
        className={`w-8 h-8 flex items-center justify-center rounded-full ${isModel ? 'bg-glow text-forest-dark' : 'bg-white/20 text-white'}`}
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>
      <div className="flex-1 h-1.5 bg-black/20 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${isModel ? 'bg-glow' : 'bg-white'}`}
          initial={{ width: 0 }}
          animate={{ width: isPlaying && !src ? '100%' : `${progress}%` }}
          transition={isPlaying && !src ? { duration: 5, ease: "linear" } : { duration: 0.1 }}
        />
      </div>
      <span className={`text-[10px] ${isModel ? 'text-glow' : 'text-white/60'}`}>
        {src && audioRef.current?.duration ? `${Math.floor(audioRef.current.duration)}s` : isPlaying ? 'Playing...' : 'Voice'}
      </span>
      {src && <audio ref={audioRef} src={src} className="hidden" />}
    </div>
  );
};

const playAnuVoice = (text: string, onEnd?: () => void) => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const cleanText = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/\*/g, '')
    .trim();

  if (!cleanText) {
    onEnd?.();
    return;
  }

  const chunks = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];

  const speakChunks = () => {
    const voices = window.speechSynthesis.getVoices();
    const tamilVoice = voices.find(v => v.lang.includes('ta') && v.name.toLowerCase().includes('google'))
      || voices.find(v => v.lang.includes('ta') && v.name.toLowerCase().includes('female'))
      || voices.find(v => v.lang.includes('ta'))
      || voices.find(v => v.lang.includes('en-IN') && v.name.toLowerCase().includes('female'));

    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk.trim());
      utterance.lang = 'ta-IN';
      utterance.rate = 0.92;
      utterance.pitch = 1.05;
      utterance.volume = 1.0;

      if (tamilVoice) utterance.voice = tamilVoice;
      if (index === chunks.length - 1) utterance.onend = () => onEnd?.();
      window.speechSynthesis.speak(utterance);
    });
  };

  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = speakChunks;
  } else {
    speakChunks();
  }
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isCalling, setIsCalling] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isLoudspeaker, setIsLoudspeaker] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageStyle, setImageStyle] = useState('Cinematic');
  const [imageAspectRatio, setImageAspectRatio] = useState('1:1');
  const [imageSteps, setImageSteps] = useState(30);
  const [imageGuidance, setImageGuidance] = useState(7.5);
  const [negativePrompt, setNegativePrompt] = useState('blurry, low quality, distorted, bad proportions');
  const [showMenu, setShowMenu] = useState(false);
  const [useAnuModel, setUseAnuModel] = useState(false);
  const [memories, setMemories] = useState<any[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const liveSessionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);

  useEffect(() => {
    fetchMessages();
    fetchMemories();
  }, []);

  const fetchMemories = async () => {
    try {
      const res = await fetch('/api/memories');
      if (res.ok) {
        const data = await res.json();
        setMemories(data);
      }
    } catch (err) {
      console.error("Fetch memories error:", err);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchMessages = async () => {
    try {
      const res = await fetch('/api/messages');
      if (!res.ok) {
        const text = await res.text();
        console.error("Server error:", text);
        return;
      }
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    const currentInput = inputText;
    const userMsg = {
      id: Date.now(),
      role: 'user' as const,
      content: currentInput,
      type: MessageType.TEXT,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsThinking(true);

    try {
      const savePromise = fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: userMsg.role, content: userMsg.content, type: userMsg.type })
      });

      let aiData;
      if (useAnuModel) {
        const localRes = await fetch('/api/chat/local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: currentInput, memories })
        });
        aiData = await localRes.json();
      } else {
        aiData = await chatWithAnu(currentInput, messages, memories);
      }

      const aiReply = aiData.reply || "I'm here for you.";
      const aiImageUrl = aiData.image_url;

      setIsThinking(false);

      playAnuVoice(aiReply);

      const tempAiMsg = {
        id: Date.now() + 1,
        role: 'model' as const,
        content: aiReply,
        type: aiImageUrl ? MessageType.IMAGE : MessageType.TEXT,
        file_url: aiImageUrl,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, tempAiMsg]);

      fetch('/api/messages/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: aiReply,
          type: tempAiMsg.type,
          file_url: aiImageUrl
        })
      }).then(r => r.json()).then(savedAiMsg => {
        setMessages(prev => prev.map(m => m.id === tempAiMsg.id ? savedAiMsg : m));
        fetchMemories();
      });

      savePromise.then(res => res.json()).then(savedUserMsg => {
        setMessages(prev => prev.map(m => m.id === userMsg.id ? savedUserMsg : m));
      });

    } catch (err: any) {
      setIsThinking(false);
      console.error("AI Error:", err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('role', 'user');
    formData.append('content', `Sent a ${file.type.startsWith('image') ? 'photo' : 'file'}`);
    formData.append('type', file.type.startsWith('image') ? MessageType.IMAGE : MessageType.FILE);

    try {
      setIsThinking(true);
      const res = await fetch('/api/messages', { method: 'POST', body: formData });
      const savedMsg = await res.json();
      setMessages(prev => [...prev, savedMsg]);

      const aiData = await chatWithAnu(`I just sent you a ${file.type.startsWith('image') ? 'photo' : 'file'}. What do you think?`, messages, memories);
      const aiReply = aiData.reply || "I'm here for you.";
      const aiImageUrl = aiData.image_url;

      setIsThinking(false);
      playAnuVoice(aiReply);

      const tempAiMsg = {
        id: Date.now() + 1,
        role: 'model' as const,
        content: aiReply,
        type: aiImageUrl ? MessageType.IMAGE : MessageType.TEXT,
        file_url: aiImageUrl,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, tempAiMsg]);

      fetch('/api/messages/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: aiReply,
          type: tempAiMsg.type,
          file_url: aiImageUrl
        })
      }).then(r => r.json()).then(savedAiMsg => {
        setMessages(prev => prev.map(m => m.id === tempAiMsg.id ? savedAiMsg : m));
        fetchMemories();
      });
    } catch (err: any) {
      setIsThinking(false);
      console.error("Upload Error:", err);
    }
  };

  const startRecording = async () => {
    try {
      setIsRecording(true);
      recordingStartTimeRef.current = Date.now();

      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg')
          ? 'audio/ogg'
          : 'audio/mp4';

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const duration = Date.now() - recordingStartTimeRef.current;
        if (duration < 500) return;

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const formData = new FormData();
        formData.append('file', audioBlob, `voice.${mimeType.split('/')[1]}`);
        formData.append('role', 'user');
        formData.append('content', 'Sent a voice message');
        formData.append('type', MessageType.AUDIO);

        try {
          setIsThinking(true);
          const res = await fetch('/api/messages', { method: 'POST', body: formData });
          const savedMsg = await res.json();
          setMessages(prev => [...prev, savedMsg]);

          const aiData = await chatWithAnu("I just sent you a voice message. How are you feeling today?", messages, memories);
          const aiReply = aiData.reply || "I'm here for you.";
          const aiImageUrl = aiData.image_url;

          setIsThinking(false);
          playAnuVoice(aiReply);

          const tempAiMsg = {
            id: Date.now() + 1,
            role: 'model' as const,
            content: aiReply,
            type: aiImageUrl ? MessageType.IMAGE : MessageType.TEXT,
            file_url: aiImageUrl,
            timestamp: new Date().toISOString()
          };
          setMessages(prev => [...prev, tempAiMsg]);

          fetch('/api/messages/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: aiReply,
              type: tempAiMsg.type,
              file_url: aiImageUrl
            })
          }).then(r => r.json()).then(savedAiMsg => {
            setMessages(prev => prev.map(m => m.id === tempAiMsg.id ? savedAiMsg : m));
            fetchMemories();
          });
        } catch (err: any) {
          setIsThinking(false);
          console.error("Voice Error:", err);
        }
      };
      recorder.start();
    } catch (err) {
      console.error("Mic access error:", err);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) return;

    try {
      setIsGeneratingImage(true);
      const imageUrl = await generateAnuImage(imagePrompt, {
        aspectRatio: imageAspectRatio,
        style: imageStyle,
        steps: imageSteps,
        guidance: imageGuidance,
        negative_prompt: negativePrompt
      });

      if (imageUrl) {
        const tempAiMsg = {
          id: Date.now(),
          role: 'model' as const,
          content: `I've created this ${imageStyle.toLowerCase()} image for you.`,
          type: MessageType.IMAGE,
          file_url: imageUrl,
          timestamp: new Date().toISOString()
        };

        setMessages(prev => [...prev, tempAiMsg]);
        setIsImageModalOpen(false);
        setImagePrompt('');

        fetch('/api/messages/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: tempAiMsg.content,
            type: MessageType.IMAGE,
            file_url: imageUrl
          })
        }).then(r => r.json()).then(savedMsg => {
          setMessages(prev => prev.map(m => m.id === tempAiMsg.id ? savedMsg : m));
        });
      }
    } catch (err: any) {
      console.error("Image Gen Error:", err);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const startCall = async () => {
    alert("Voice calls are currently being optimized for forest life! Use chat for now. ❤️");
  };

  const endCall = () => {
    setIsCalling(false);
    setLiveTranscript('');
  };

  return (
    <div className="flex flex-col fixed inset-0 overflow-hidden bg-forest-dark">
      <header className="wood-panel h-20 flex items-center px-4 justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full border-2 border-glow overflow-hidden bg-forest-light flex items-center justify-center">
            <img src="https://picsum.photos/seed/anu/200" alt="Anu" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-bold glow-text">Anu</h1>
            <p className="text-xs text-glow/80">Online • Enchanted Forest</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Model Switcher */}
          <div className="hidden md:flex bg-black/40 backdrop-blur-md p-1 rounded-full border border-white/10">
            <button
              onClick={() => setUseAnuModel(false)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs transition-all ${!useAnuModel ? 'bg-glow text-forest-dark font-bold shadow-lg' : 'text-white/60'}`}
            >
              <Sparkles className="w-3 h-3" />
              Gemini
            </button>
            <button
              onClick={() => setUseAnuModel(true)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs transition-all ${useAnuModel ? 'bg-forest-light text-glow border border-glow/30 font-bold shadow-lg' : 'text-white/60'}`}
            >
              <RefreshCw className="w-3 h-3" />
              Anu Local
            </button>
          </div>

          <button onClick={startCall} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Phone className="w-6 h-6 text-glow" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <MoreVertical className="w-6 h-6 text-glow" />
            </button>

            <AnimatePresence>
              {showMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  className="absolute right-0 mt-2 w-48 wood-panel border border-glow/30 rounded-xl shadow-2xl z-50 overflow-hidden"
                >
                  <button
                    onClick={() => {
                      setIsImageModalOpen(true);
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-glow/20 text-glow transition-colors text-sm"
                  >
                    <ImageIcon className="w-4 h-4" />
                    Generate Image
                  </button>
                  <button
                    onClick={() => {
                      fetchMessages();
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-glow/20 text-glow transition-colors text-sm border-t border-glow/10"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh Chat
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <main ref={scrollRef} className="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-2 bg-black/20 backdrop-blur-sm scroll-smooth">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`message-bubble ${msg.role === 'user' ? 'user-bubble' : 'model-bubble'}`}
            >
              {msg.type === MessageType.IMAGE && (
                <div className="relative group">
                  <img src={msg.file_url} alt="Shared" className="rounded-lg mb-2 max-w-full" />
                  <a
                    href={msg.file_url}
                    download={`anu-magic-${Date.now()}.png`}
                    className="absolute top-2 right-2 p-2 bg-black/60 backdrop-blur-md rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-glow hover:text-forest-dark"
                    title="Download Image"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              )}
              {msg.type === MessageType.AUDIO && msg.role === 'user' && msg.file_url && (
                <AudioPlayer src={msg.file_url} isModel={false} />
              )}
              {msg.type === MessageType.FILE && (
                <div className="flex items-center gap-2 p-2 bg-black/20 rounded-lg">
                  <Paperclip className="w-4 h-4" />
                  <span className="text-xs truncate">{msg.file_url?.split('/').pop()}</span>
                </div>
              )}
              <div className="prose prose-invert prose-sm">
                <Markdown>{msg.content}</Markdown>
              </div>
              {msg.role === 'model' && (
                <AudioPlayer
                  src={msg.audio_url}
                  text={!msg.audio_url ? msg.content : undefined}
                  isModel={true}
                />
              )}
              <span className="text-[10px] opacity-50 block mt-1 text-right">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        {isThinking && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="message-bubble model-bubble self-start"
          >
            <div className="flex flex-col gap-2 p-2">
              <div className="flex gap-1 items-center">
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-glow rounded-full" />
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-glow rounded-full" />
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-glow rounded-full" />
              </div>
              {useAnuModel && (
                <div className="text-[10px] text-glow/60 font-mono animate-pulse">
                  Automation thinking steps active...
                </div>
              )}
            </div>
          </motion.div>
        )}
      </main>

      <footer className="wood-panel p-2 sm:p-3 pb-safe-offset flex items-center gap-2 sm:gap-3 shrink-0 z-10 border-t border-glow/20">
        <label className="p-2 hover:bg-white/10 rounded-full cursor-pointer transition-colors">
          <Paperclip className="w-6 h-6 text-glow" />
          <input type="file" className="hidden" onChange={handleFileUpload} />
        </label>
        <div className="flex-1 relative">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Message Anu..."
            className="w-full bg-black/60 border border-glow/30 rounded-full px-4 py-2.5 focus:outline-none focus:border-glow transition-all text-sm md:text-base placeholder:text-white/40 shadow-inner"
          />
        </div>
        {inputText.trim() ? (
          <button onClick={() => handleSendMessage()} className="w-12 h-12 bg-glow rounded-full flex items-center justify-center shadow-lg shadow-glow/20 hover:scale-105 active:scale-95 transition-all">
            <Send className="w-6 h-6 text-forest-dark" />
          </button>
        ) : (
          <button className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-glow'}`} onMouseDown={startRecording} onMouseUp={stopRecording} onTouchStart={startRecording} onTouchEnd={stopRecording}>
            <Mic className={`w-6 h-6 ${isRecording ? 'text-white' : 'text-forest-dark'}`} />
          </button>
        )}
      </footer>

      {/* Image Generation Modal */}
      <AnimatePresence>
        {isImageModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="wood-panel w-full max-w-md rounded-3xl border border-glow/30 p-6 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-serif text-2xl font-bold text-glow">Create Magic</h2>
                <button onClick={() => setIsImageModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full">
                  <X className="w-6 h-6 text-white/60" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-medium text-glow/60 uppercase tracking-widest mb-2">What should I draw?</label>
                  <textarea
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder="A glowing butterfly in the enchanted forest..."
                    className="w-full bg-black/30 border border-glow/20 rounded-2xl p-4 text-white placeholder:text-white/20 focus:outline-none focus:border-glow/50 transition-all min-h-[100px] resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-glow/60 uppercase tracking-widest mb-2 text-center">Style</label>
                    <select
                      value={imageStyle}
                      onChange={(e) => setImageStyle(e.target.value)}
                      className="w-full bg-black/30 border border-glow/10 rounded-xl p-2 text-xs text-white focus:outline-none"
                    >
                      <option value="Cinematic">Cinematic</option>
                      <option value="Digital Art">Digital Art</option>
                      <option value="Anime">Anime</option>
                      <option value="Oil Painting">Oil Painting</option>
                      <option value="3D Render">3D Render</option>
                      <option value="Sketch">Sketch</option>
                      <option value="Neon/Cyberpunk">Neon/Cyberpunk</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-glow/60 uppercase tracking-widest mb-2 text-center">Ratio</label>
                    <select
                      value={imageAspectRatio}
                      onChange={(e) => setImageAspectRatio(e.target.value)}
                      className="w-full bg-black/30 border border-glow/10 rounded-xl p-2 text-xs text-white focus:outline-none"
                    >
                      <option value="1:1">1:1 Square</option>
                      <option value="16:9">16:9 Landscape</option>
                      <option value="9:16">9:16 Portrait</option>
                      <option value="4:3">4:3 Classic</option>
                      <option value="3:4">3:4 Tall</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-[10px] text-glow/60 uppercase tracking-widest px-1">
                      <span>Steps: {imageSteps}</span>
                      <span>Guidance: {imageGuidance}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <input
                        type="range" min="10" max="100" step="5"
                        value={imageSteps} onChange={(e) => setImageSteps(parseInt(e.target.value))}
                        className="accent-glow h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                      <input
                        type="range" min="1" max="20" step="0.5"
                        value={imageGuidance} onChange={(e) => setImageGuidance(parseFloat(e.target.value))}
                        className="accent-glow h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-glow/60 uppercase tracking-widest mb-2">Negative (Avoid)</label>
                    <input
                      type="text"
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      placeholder="What to exclude..."
                      className="w-full bg-black/30 border border-glow/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-glow/50"
                    />
                  </div>
                </div>

                <button
                  onClick={handleGenerateImage}
                  disabled={isGeneratingImage || !imagePrompt.trim()}
                  className={`w-full py-4 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3 shadow-xl ${isGeneratingImage || !imagePrompt.trim() ? 'bg-white/10 text-white/30 cursor-not-allowed' : 'bg-glow text-forest-dark hover:scale-[1.02] active:scale-[0.98]'}`}
                >
                  {isGeneratingImage ? (
                    <>
                      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                        <RefreshCw className="w-6 h-6" />
                      </motion.div>
                      Creating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-6 h-6" />
                      Generate Image
                    </>
                  )}
                </button>

                <p className="text-[10px] text-white/40 text-center italic">
                  Powered by Gemini Flash Image • Free & Unlimited
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCalling && (
          <motion.div initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }} className="fixed inset-0 z-50 bg-forest-dark flex flex-col items-center justify-between py-20 px-6" style={{ backgroundImage: "url('https://picsum.photos/seed/forest-call/1080/1920?blur=2')", backgroundSize: 'cover' }}>
            <div className="absolute inset-0 bg-black/60" />
            <div className="relative z-10 flex flex-col items-center gap-4">
              <div className="w-32 h-32 rounded-full border-4 border-glow p-1 overflow-hidden">
                <img src="https://picsum.photos/seed/anu/400" alt="Anu" className="w-full h-full object-cover rounded-full" />
              </div>
              <h2 className="font-serif text-4xl font-bold glow-text">Anu</h2>
              <p className="text-glow animate-pulse">Ringing...</p>
            </div>
            <div className="relative z-10 w-full max-w-md bg-black/40 backdrop-blur-md rounded-3xl p-6 border border-glow/20 h-48 overflow-y-auto">
              <p className="text-sm text-glow/60 uppercase tracking-widest mb-2 font-mono">Live Transcript</p>
              <p className="text-lg font-serif italic leading-relaxed">{liveTranscript || "Listening to the forest..."}</p>
            </div>
            <div className="relative z-10 flex items-center gap-8">
              <button onClick={() => setIsMuted(!isMuted)} className={`w-16 h-16 rounded-full flex items-center justify-center border-2 transition-all ${isMuted ? 'bg-red-500/20 border-red-500' : 'bg-white/10 border-white/20'}`}>
                {isMuted ? <Mic className="w-8 h-8 text-red-500" /> : <Mic className="w-8 h-8 text-white" />}
              </button>
              <button onClick={endCall} className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center shadow-xl shadow-red-500/40 hover:scale-110 active:scale-95 transition-all">
                <PhoneOff className="w-10 h-10 text-white" />
              </button>
              <button onClick={() => setIsLoudspeaker(!isLoudspeaker)} className={`w-16 h-16 rounded-full flex items-center justify-center border-2 transition-all ${isLoudspeaker ? 'bg-glow/20 border-glow' : 'bg-white/10 border-white/20'}`}>
                {isLoudspeaker ? <Volume2 className="w-8 h-8 text-glow" /> : <VolumeX className="w-8 h-8 text-white" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <div className="bg-forest-dark border-2 border-glow rounded-3xl p-8 flex flex-col items-center gap-6 shadow-2xl shadow-glow/20">
              <div className="relative">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="w-24 h-24 bg-glow/20 rounded-full absolute -inset-4"
                />
                <div className="w-24 h-24 bg-glow rounded-full flex items-center justify-center relative">
                  <Mic className="w-12 h-12 text-forest-dark" />
                </div>
              </div>
              <div className="text-center">
                <h3 className="text-glow text-xl font-bold mb-1">Recording...</h3>
                <p className="text-glow/60 text-sm">Release to send to Anu</p>
              </div>
              <div className="flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ height: [8, 24, 8] }}
                    transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                    className="w-1 bg-glow rounded-full"
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
