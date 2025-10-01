// app/components/MockInterview.tsx

import { useEffect, useRef, useState } from "react";
import { usePuterStore } from "~/lib/puter";

interface MockInterviewProps {
    feedback: any;
    onClose: () => void;
}

type InterviewStatus = "not_started" | "greeting" | "waiting_to_begin" | "asking_question" | "waiting_for_answer" | "listening_to_answer" | "processing_answer" | "showing_results";

let recognition: SpeechRecognition | null = null;

export function MockInterview({ feedback, onClose }: MockInterviewProps) {
    const { ai } = usePuterStore();
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [status, setStatus] = useState<InterviewStatus>("not_started");
    const [conversation, setConversation] = useState<string[]>([]);
    const [statusText, setStatusText] = useState("Set your interview duration and click 'Start' to begin.");
    const [isListening, setIsListening] = useState(false);
    const [interviewResults, setInterviewResults] = useState<any | null>(null);
    const [duration, setDuration] = useState(5);
    const [timeLeft, setTimeLeft] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    
    const stopAllMedia = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        if (timerRef.current) clearInterval(timerRef.current);
    };

    const handleClose = () => {
        stopAllMedia();
        onClose();
    };

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
        }
        const getMedia = async () => {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                streamRef.current = mediaStream;
                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                    
                    // --- THIS IS THE FIX ---
                    // We explicitly tell the video to play after receiving the stream.
                    videoRef.current.play().catch(error => {
                        console.error("Error attempting to play video:", error);
                        setStatusText("Could not start video. Please click anywhere on the page and try again.");
                    });
                }
            } catch (err) {
                setStatusText("Could not access camera. Please check permissions.");
            }
        };
        getMedia();
        return () => stopAllMedia();
    }, []);

    useEffect(() => {
        if (["greeting", "asking_question", "waiting_for_answer", "listening_to_answer", "waiting_to_begin"].includes(status)) {
            timerRef.current = setInterval(() => {
                setTimeLeft(prev => {
                    if (prev <= 1) {
                        handleStopInterview("Time's up!");
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [status]);

    const speak = (text: string, onEnd?: () => void) => {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            const utterance = new SpeechSynthesisUtterance(text);
            if (onEnd) utterance.onend = onEnd;
            window.speechSynthesis.speak(utterance);
        } else {
            if (onEnd) setTimeout(onEnd, 1000);
        }
    };
    
    const generateFeedback = async () => {
        setStatus("showing_results");
        setStatusText("Analyzing your performance...");
        const feedbackPrompt = `Based on the interview transcript, provide feedback on clarity, confidence, and relevance. Provide a score/100, confidence level, and 3-4 improvement areas. Transcript: ${conversation.join("\n")} Format as JSON: { "overallScore": number, "confidenceLevel": "string", "improvements": ["string", ...] }`;
        try {
            const feedbackResponse = await ai.chat(feedbackPrompt);
            if (!feedbackResponse?.message?.content) throw new Error("Invalid AI feedback response");
            const resultsJson = JSON.parse(feedbackResponse.message.content as string);
            setInterviewResults(resultsJson);
        } catch (error) {
            setStatusText("Sorry, I couldn't generate feedback.");
        }
    };

    const getNextQuestion = async (currentConversation: string[]) => {
        setStatus("asking_question");
        setStatusText("Thinking of the next question...");
        const prompt = `You are a professional and friendly hiring manager. Your goal is to conduct a supportive, medium-level mock interview. Do not be overly strict or ask impossibly difficult questions. Your tone is encouraging and professional. You listen to the user's answers and ask relevant follow-up questions, but you also introduce new topics from a structured list. You ask a mix of question types: behavioral ("Tell me about a time..."), technical (based on the resume), and resume-specific. Based on the resume analysis and conversation history, ask the single next interview question. Just ask the question without extra filler. Resume Analysis: ${JSON.stringify(feedback)}. Conversation History: ${currentConversation.join("\n")}`;
        try {
            const response = await ai.chat(prompt);
            if (!response?.message?.content) throw new Error("Invalid AI response");
            const question = response.message.content as string;
            setConversation(prev => [...prev, `AI: ${question}`]);
            setStatusText(question);
            speak(question, () => setStatus("waiting_for_answer"));
        } catch (error) {
            setStatusText("Sorry, an error occurred.");
            setStatus("not_started");
        }
    };

    const handleListen = () => {
        if (!recognition) return;
        setIsListening(true);
        setStatus("listening_to_answer");
        setStatusText("Listening...");
        recognition.start();
        recognition.onresult = (event: SpeechRecognitionEvent) => {
            const userAnswer = event.results[0][0].transcript;
            if(recognition) recognition.stop();
            setIsListening(false);
            const updatedConversation = [...conversation, `User: ${userAnswer}`];
            setConversation(updatedConversation);
            setStatus("processing_answer");
            setStatusText("Processing your answer...");
            getNextQuestion(updatedConversation);
        };
        recognition.onerror = () => {
            setIsListening(false);
            setStatusText("I didn't catch that. Please try again.");
            setStatus("waiting_for_answer");
        };
    };
    
    const handleStopInterview = (reason: string = "Interview stopped by user.") => {
        stopAllMedia();
        setConversation(prev => [...prev, `System: ${reason}`]);
        if (conversation.length > 1) {
            generateFeedback();
        } else {
            onClose();
        }
    };
    
    const handleStartInterview = async () => {
        setTimeLeft(duration * 60);
        setStatus("greeting");
        setStatusText("Connecting to the interviewer...");
        const greetingPrompt = "You are a professional interviewer. Please provide a brief, friendly introduction. Do not ask a question yet. For example: 'Hello, thank you for coming in today. We'll chat for about " + duration + " minutes. Are you ready to begin?'";
        try {
            const response = await ai.chat(greetingPrompt);
            if (!response?.message?.content) throw new Error("Invalid AI response");
            const greeting = response.message.content as string;
            setConversation([`AI: ${greeting}`]);
            setStatusText(greeting);
            speak(greeting, () => setStatus("waiting_to_begin"));
        } catch (error) {
            setStatus("not_started");
            setStatusText("Sorry, the interviewer could not connect. Please try again.");
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col p-4">
                <div className="flex justify-between items-center border-b pb-2 mb-4">
                    <h2 className="text-2xl font-bold">{status === "showing_results" ? "Interview Feedback" : "Mock Interview"}</h2>
                    {timeLeft > 0 && <p className="text-lg font-mono bg-gray-200 px-3 py-1 rounded-md">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</p>}
                    <button onClick={handleClose} className="p-2 rounded-full hover:bg-gray-200"><img src="/icons/cross.svg" alt="close" className="w-6 h-6" /></button>
                </div>
                
                {status !== "showing_results" ? (
                    <>
                        {status === "not_started" ? (
                            <div className="flex flex-col items-center justify-center h-full">
                                <h3 className="text-2xl font-semibold mb-4">Set Interview Duration</h3>
                                <div className="flex space-x-4 mb-8">
                                    {[5, 10, 15].map(time => (<button key={time} onClick={() => setDuration(time)} className={`px-6 py-2 rounded-full font-semibold text-lg ${duration === time ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>{time} min</button>))}
                                </div>
                                <button onClick={handleStartInterview} className="bg-blue-600 text-white font-bold py-3 px-8 rounded-full text-xl hover:bg-blue-700">Start Interview</button>
                            </div>
                        ) : (
                            <>
                                <div className="flex-grow relative bg-gray-900 rounded-lg overflow-hidden">
                                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                                    <div className="absolute top-4 right-4 w-48 h-36 bg-gray-800 border-2 border-blue-500 rounded-md flex items-center justify-center p-2"><p className="text-white text-center text-sm">AI Interviewer</p></div>
                                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black bg-opacity-50 text-white px-4 py-2 rounded-lg max-w-3xl text-center"><p>{statusText}</p></div>
                                </div>
                                <div className="flex justify-center items-center border-t pt-4 mt-4 space-x-4">
                                    {status === "waiting_to_begin" && <button onClick={() => getNextQuestion(conversation)} className="bg-green-600 text-white font-bold py-3 px-6 rounded-full text-lg hover:bg-green-700">Begin</button>}
                                    {status === "waiting_for_answer" && <button onClick={handleListen} className={`font-bold py-3 px-6 rounded-full text-lg text-white ${isListening ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'}`}>{isListening ? "Listening..." : "Answer"}</button>}
                                    {["greeting", "asking_question", "processing_answer", "listening_to_answer"].includes(status) && <button disabled className="bg-gray-400 text-white font-bold py-3 px-6 rounded-full text-lg">Please Wait...</button>}
                                    {status !== "greeting" && status !== "waiting_to_begin" && <button onClick={() => handleStopInterview()} className="bg-red-600 text-white font-bold py-3 px-6 rounded-full text-lg hover:bg-red-700">Stop Interview</button>}
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <div className="flex-grow p-6 overflow-y-auto">
                        <h3 className="text-3xl font-bold text-center mb-6">Your Performance Report</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-center">
                            <div className="bg-blue-100 p-4 rounded-lg"><p className="text-lg font-semibold text-blue-800">Overall Score</p><p className="text-5xl font-bold text-blue-600">{interviewResults?.overallScore}/100</p></div>
                            <div className="bg-green-100 p-4 rounded-lg"><p className="text-lg font-semibold text-green-800">Confidence Level</p><p className="text-5xl font-bold text-green-600">{interviewResults?.confidenceLevel}</p></div>
                        </div>
                        <div className="mt-8">
                            <h4 className="text-2xl font-bold mb-3">Areas for Improvement</h4>
                            <ul className="list-disc list-inside space-y-2 text-gray-700">{interviewResults?.improvements.map((tip: string, index: number) => (<li key={index}>{tip}</li>))}</ul>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}