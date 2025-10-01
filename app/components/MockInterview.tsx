// app/components/MockInterview.tsx

import { useEffect, useRef, useState, useCallback } from "react";
import { usePuterStore } from "~/lib/puter";

interface MockInterviewProps {
    onClose: () => void;
}

type InterviewStatus = "not_started" | "greeting" | "waiting_to_begin" | "asking_question" | "waiting_for_answer" | "listening_to_answer" | "processing_answer" | "showing_results";

export function MockInterview({ onClose }: MockInterviewProps) {
    const { ai } = usePuterStore();
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recognitionRef = useRef<any>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const [status, setStatus] = useState<InterviewStatus>("not_started");
    const [conversation, setConversation] = useState<string[]>([]);
    const [statusText, setStatusText] = useState("Set your interview duration and click 'Start' to begin.");
    const [isListening, setIsListening] = useState(false);
    const [interviewResults, setInterviewResults] = useState<any>(null);
    const [duration, setDuration] = useState(10);
    const [timeLeft, setTimeLeft] = useState(0);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1);
    const [isCameraOn, setIsCameraOn] = useState(false);

    const interviewQuestions = [
        "Can you walk me through your resume?",
        "What motivated you to apply for this position?",
        "Tell me about a challenging project you worked on.",
        "Describe a situation where you had to work with a difficult team member.",
        "Where do you see yourself in 5 years?",
        "Tell me about a time you made a mistake at work.",
        "How do you handle tight deadlines and competing priorities?",
        "What is your greatest professional strength?",
        "What area do you feel you need to improve the most?",
        "Why should we hire you over other candidates?"
    ];

    const stopAllMedia = useCallback(() => {
        if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch (e) {} }
        if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); }
        if (typeof window !== 'undefined') { window.speechSynthesis.cancel(); }
        if (timerRef.current) { clearInterval(timerRef.current); }
        setIsListening(false);
        setIsCameraOn(false);
    }, []);

    const generateFeedback = useCallback(async () => {
        setStatus("showing_results");
        setStatusText("Analyzing your performance...");

        if (!ai || conversation.length < 2) {
            // Handle cases with no AI or no conversation
            return;
        }

        const transcript = conversation.join('\n');
        const systemPrompt = `You are an expert HR manager. Analyze the following interview transcript. Your response MUST be a valid JSON object and nothing else. The JSON object must have this structure: { "overallScore": number, "confidenceLevel": "High" | "Medium" | "Low", "strengths": string[], "improvements": string[], "suggestions": string[] }`;

        try {
            const response = await ai.chat(
                [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Analyze this transcript:\n\n${transcript}` }],
                { model: 'gpt-4-turbo' }
            );

            if (!response) {
                throw new Error("Received an undefined response from the AI.");
            }
            
            const feedbackContent = String(response);
            const parsedFeedback = JSON.parse(feedbackContent);
            setInterviewResults(parsedFeedback);
            setStatusText("Feedback ready!");

        } catch (error) {
            console.error("Error generating AI feedback:", error);
            // Handle error state
        }
    }, [ai, conversation]);

    const handleStopInterview = useCallback(() => {
        stopAllMedia();
        generateFeedback();
    }, [stopAllMedia, generateFeedback]);

    const speak = useCallback((text: string): Promise<void> => {
        return new Promise((resolve) => {
            if (typeof window !== 'undefined' && window.speechSynthesis) {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = 0.9;
                utterance.onend = () => resolve();
                utterance.onerror = () => resolve();
                window.speechSynthesis.speak(utterance);
            } else {
                resolve();
            }
        });
    }, []);

    const getNextQuestion = useCallback(async () => {
        if (currentQuestionIndex >= interviewQuestions.length - 1) {
            handleStopInterview();
            return;
        }
        setStatus("asking_question");
        const nextIndex = currentQuestionIndex + 1;
        setCurrentQuestionIndex(nextIndex);
        const question = interviewQuestions[nextIndex];
        setStatusText(question);
        setConversation(prev => [...prev, `AI: ${question}`]);
        await speak(question);
        setStatus("waiting_for_answer");
    }, [currentQuestionIndex, handleStopInterview, interviewQuestions, speak]);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-US';
        recognition.onresult = (event: any) => {
            const userAnswer = event.results[0][0].transcript;
            setConversation(prev => [...prev, `User: ${userAnswer}`]);
            setStatus("processing_answer");
        };
        recognition.onerror = () => setStatus("waiting_for_answer");
        recognition.onend = () => setIsListening(false);
        recognitionRef.current = recognition;
    }, []);

    useEffect(() => {
        if (status === "processing_answer") {
            setStatusText("Great! Processing your answer...");
            setTimeout(() => getNextQuestion(), 1000);
        }
    }, [status, getNextQuestion]);

    useEffect(() => {
        if (["asking_question", "waiting_for_answer", "listening_to_answer"].includes(status) && timeLeft > 0) {
            timerRef.current = setInterval(() => {
                setTimeLeft(prev => {
                    if (prev <= 1) { handleStopInterview(); return 0; }
                    return prev - 1;
                });
            }, 1000);
        } else if (timerRef.current) {
            clearInterval(timerRef.current);
        }
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [status, timeLeft, handleStopInterview]);

    const handleListen = () => {
        if (!recognitionRef.current) return;
        setIsListening(true);
        setStatus("listening_to_answer");
        setStatusText("Listening...");
        try {
            recognitionRef.current.start();
        } catch (e) {
            setIsListening(false);
            setStatus("waiting_for_answer");
        }
    };

    const startCamera = async () => {
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
                streamRef.current = mediaStream;
                await videoRef.current.play();
                setIsCameraOn(true);
                return true;
            }
        } catch (error) { console.error("Camera error:", error); }
        return false;
    };

    const handleStartInterview = async () => {
        setStatus("greeting");
        setStatusText("Starting camera...");
        if (!await startCamera()) {
            setStatus("not_started");
            setStatusText("Camera access failed. Please check permissions.");
            return;
        }
        setTimeLeft(duration * 60);
        const greeting = "Welcome! Click 'Begin Interview' when ready.";
        setStatusText(greeting);
        await speak(greeting);
        setStatus("waiting_to_begin");
    };

    const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[95vh] flex flex-col overflow-hidden">
                <div className="flex justify-between items-center border-b p-6">
                    <h2 className="text-2xl font-bold">{status === "showing_results" ? "Interview Feedback" : "Mock Interview"}</h2>
                    {status !== "not_started" && <div className="bg-blue-100 px-4 py-2 rounded-lg"><p className="font-mono text-blue-800">{formatTime(timeLeft)}</p></div>}
                    <button onClick={() => { stopAllMedia(); onClose(); }} className="p-3"><div className="w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center text-white font-bold">×</div></button>
                </div>
                <div className="flex-1 overflow-hidden">
                    {status !== "showing_results" ? (
                        <>
                            {status === "not_started" ? (
                                <div className="flex flex-col items-center justify-center h-full p-8">
                                    <h3 className="text-4xl font-bold">AI Mock Interview</h3>
                                    <p className="text-xl text-gray-600 mt-2">Practice and get instant feedback.</p>
                                    <div className="bg-white p-8 mt-8 rounded-2xl shadow-lg w-full max-w-md">
                                        <h4 className="text-2xl font-semibold mb-6 text-center">Set Duration</h4>
                                        <div className="flex justify-center space-x-4 mb-8">{[10, 15, 20].map(time => (<button key={time} onClick={() => setDuration(time)} className={`px-8 py-4 rounded-xl ${duration === time ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>{time} min</button>))}</div>
                                        <p className="text-center text-gray-500 mb-6">{statusText}</p>
                                        <button onClick={handleStartInterview} className="w-full bg-blue-600 text-white font-bold py-5 rounded-xl text-xl">🎬 Start Interview</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="relative bg-black h-2/3">
                                        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                                        {!isCameraOn && <div className="absolute inset-0 flex items-center justify-center bg-gray-800"><p className="text-xl text-white">Camera Loading...</p></div>}
                                        <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-70 text-white p-4 rounded-lg text-center"><p className="text-lg">{statusText}</p></div>
                                    </div>
                                    <div className="p-6 border-t flex-1 flex justify-center items-center">
                                        <div className="flex items-center space-x-4">
                                            {status === "waiting_to_begin" && <button onClick={getNextQuestion} className="bg-green-600 text-white font-bold py-4 px-10 rounded-xl">🚀 Begin Interview</button>}
                                            {status === "waiting_for_answer" && <button onClick={handleListen} disabled={isListening} className={`py-4 px-10 rounded-xl ${isListening ? 'bg-yellow-500' : 'bg-green-600 text-white'}`}>{isListening ? "🎤 Listening..." : "💬 Answer"}</button>}
                                            {["greeting", "processing_answer", "listening_to_answer"].includes(status) && <button disabled className="bg-gray-400 text-white font-bold py-4 px-8 rounded-xl">⏳ Wait...</button>}
                                            
                                            {/* CORRECTED: The redundant check that caused the error is now removed. */}
                                            {status !== "waiting_to_begin" && <button onClick={handleStopInterview} className="bg-red-600 text-white font-bold py-4 px-8 rounded-xl">⏹️ End</button>}
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                         <div className="h-full p-6 bg-gray-50 overflow-y-auto">
                            <div className="max-w-4xl mx-auto">
                                <h3 className="text-4xl font-bold text-center">Interview Report</h3>
                                <p className="text-center text-gray-600 my-2">{statusText}</p>
                                <div className="grid md:grid-cols-2 gap-6 my-8">
                                    <div className="bg-white p-8 rounded-xl shadow text-center"><p className="text-xl font-semibold text-blue-800 mb-4">Overall Score</p><div className="text-6xl font-bold text-blue-600">{interviewResults?.overallScore || 'N/A'}/100</div></div>
                                    <div className="bg-white p-8 rounded-xl shadow text-center"><p className="text-xl font-semibold text-green-800 mb-4">Confidence</p><div className="text-6xl font-bold text-green-600">{interviewResults?.confidenceLevel || "N/A"}</div></div>
                                </div>
                                <div className="grid md:grid-cols-2 gap-6 mb-8">
                                    <div className="bg-white p-6 rounded-xl shadow"><h4 className="text-2xl font-bold mb-4 text-green-800">✅ Strengths</h4><ul className="space-y-3">{(interviewResults?.strengths || []).map((s: string, i: number) => <li key={i}>✔ {s}</li>)}</ul></div>
                                    <div className="bg-white p-6 rounded-xl shadow"><h4 className="text-2xl font-bold mb-4 text-yellow-800">💡 Suggestions</h4><ul className="space-y-3">{(interviewResults?.suggestions || []).map((s: string, i: number) => <li key={i}>💡 {s}</li>)}</ul></div>
                                </div>
                                <div className="bg-white p-8 rounded-xl shadow mb-8"><h4 className="text-2xl font-bold mb-6 text-red-800 text-center">🎯 Improvements</h4><ul className="space-y-4">{(interviewResults?.improvements || []).map((tip: string, i: number) => <li key={i} className="p-3 bg-red-50 rounded-lg">→ {tip}</li>)}</ul></div>
                                <div className="flex justify-center space-x-6">
                                    <button onClick={() => setStatus("not_started")} className="bg-blue-600 text-white font-bold py-4 px-10 rounded-xl">🔄 Practice Again</button>
                                    <button onClick={() => { stopAllMedia(); onClose(); }} className="bg-gray-600 text-white font-bold py-4 px-10 rounded-xl">✅ Finish</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
