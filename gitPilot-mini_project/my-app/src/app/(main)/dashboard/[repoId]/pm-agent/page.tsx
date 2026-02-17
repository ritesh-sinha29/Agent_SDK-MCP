"use client";
import React from "react";
import { useQuery } from "convex/react";
import { Doc, Id } from "../../../../../../convex/_generated/dataModel";
import { api } from "../../../../../../convex/_generated/api";
import { useParams } from "next/navigation";
import type { ChatStatus, UIMessage } from "ai";
import {
  AlertCircle,
  Copy,
  LucideBrain,
  MessageSquare,
  RefreshCw,
  Mic,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Orb, type AgentState } from "@/components/ui/orb";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition"
import { useAudioPlayer } from "@/hooks/use-audio-player"


const PmPage = () => {
  const params = useParams();
  const [input, setInput] = React.useState("");
  const [isOrbVisible, setIsOrbVisible] = React.useState(false);
  const repoId = params.repoId as Id<"repositories">;
  
  // Voice Hooks
  const { 
    isListening, 
    transcript, 
    startListening, 
    stopListening, 
    resetTranscript 
  } = useSpeechRecognition()
  
  const { 
    playAudio, 
    stopAudio, 
    isPlaying: isAgentSpeaking, 
    volume: outputVolume 
  } = useAudioPlayer()

  // Track if we are waiting for a response to speak
  const [isWaitingForTTS, setIsWaitingForTTS] = React.useState(false)
  const processedMessageIds = React.useRef<Set<string>>(new Set())
  const voiceMessageIds = React.useRef<Set<string>>(new Set())

  const {
    messages,
    sendMessage,
    status,
    setMessages,
    addToolApprovalResponse,
  } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent/chat",
      body: {
        repoId: repoId || params.repoId,
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: async (result: any) => {
      // Handle both potential signatures (message directly or { message })
      const message = result.message || result;
      
      // Only speak if we are in "voice mode" (orb visible) and message is from assistant
      if (isOrbVisible && message.role === "assistant" && !processedMessageIds.current.has(message.id)) {
        processedMessageIds.current.add(message.id)
        
        // Extract text from parts if available (v4 SDK style), otherwise use content
        const textToSpeak = message.parts 
          ? message.parts
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text || (p as any).content)
              .join(' ')
          : message.content;

        if (!textToSpeak || !textToSpeak.trim()) return;

        setIsWaitingForTTS(true)
        try {
            const response = await fetch('/api/voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: textToSpeak }),
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to generate audio');
            }

            const { audio } = await response.json();
            await playAudio(audio)
        } catch (e) {
            console.error("TTS Error", e)
        } finally {
            setIsWaitingForTTS(false)
        }
      }
    }
  });

  // Auto-submit logic for voice
  React.useEffect(() => {
    if (isListening && transcript) {
        // Debounce silence to detect end of speech
        const timer = setTimeout(() => {
            stopListening()
            sendMessage({
                parts: [{ type: "text", text: transcript }]
            })
            resetTranscript()
        }, 1500) // 1.5s silence

        return () => clearTimeout(timer)
    }
  }, [transcript, isListening, stopListening, sendMessage, resetTranscript])

  // Continuous voice mode: restart listening after agent finishes speaking
  React.useEffect(() => {
      if (isOrbVisible && !isAgentSpeaking && !isListening && !isWaitingForTTS && status !== 'submitted' && status !== 'streaming') {
          const timeout = setTimeout(() => {
              startListening()
          }, 100)
          return () => clearTimeout(timeout)
      }
  }, [isOrbVisible, isAgentSpeaking, isListening, isWaitingForTTS, status, startListening])

  // Track messages created during voice mode
  const previousMessageCountRef = React.useRef(0)
  React.useEffect(() => {
      if (isOrbVisible) {
          // Only tag messages that are NEW (added after Orb opened)
          const newMessages = messages.slice(previousMessageCountRef.current)
          newMessages.forEach(message => {
              voiceMessageIds.current.add(message.id)
          })
      }
      previousMessageCountRef.current = messages.length
  }, [messages, isOrbVisible])

  const isLastMessageFromAssistant =
    messages.length > 0 && messages[messages.length - 1].role === "assistant";

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    sendMessage({
      parts: [{ type: "text", text: input }],
    });
    setInput("");
  };

  // Determine agent state based on chat status and voice state
  const getAgentState = (): AgentState => {
    if (isAgentSpeaking) return "talking"
    if (isListening) return "listening"
    if (status === "submitted" || isWaitingForTTS) return "thinking"
    if (status === "streaming") return "thinking" // While streaming text, we are technically "thinking" about the audio? Or should we show "talking" if text is appearing? Let's say thinking until audio plays.
    return null; // Default to idle
  };
  
  const handleMicClick = () => {
    setIsOrbVisible(true)
    startListening()
  }
  
  const handleCloseOrb = () => {
      setIsOrbVisible(false)
      stopListening()
      stopAudio()
  }

  return (
    <div className="h-[calc(100vh-60px)] w-full flex flex-col relative px-12">
      {/* Voice Interaction Button */}
      <div className="absolute top-4 right-4 z-40">
        <Button
          variant="outline"
          size="icon"
          className={`rounded-full h-10 w-10 border-violet-500/50 hover:bg-violet-500/10 hover:border-violet-500 text-violet-500 ${isListening ? "animate-pulse bg-violet-500/20" : ""}`}
          onClick={handleMicClick}
        >
          <Mic className="h-5 w-5" />
        </Button>
      </div>

      {/* Orb Overlay */}
      {isOrbVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-500">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-8 right-8 text-white/50 hover:text-white hover:bg-white/10 rounded-full h-12 w-12 transition-all duration-300"
            onClick={handleCloseOrb}
          >
            <X className="h-6 w-6" />
          </Button>
          
          <div className="relative h-[200px] w-[200px] animate-in zoom-in-95 duration-500 spring-3">
            <Orb
              // Colors are now handled internally based on agentState
              agentState={getAgentState()}
              className="h-full w-full"
              inputVolumeRef={{ current: 0 }} 
              outputVolumeRef={{ current: outputVolume }}
            />
          </div>
        </div>
      )}
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<MessageSquare className="size-12" />}
              title="Start a conversation"
              description="Ask any question! from your PM"
            />
          ) : (
            <>
              {messages.map((message, messageIndex) => {
                const isLastMessage = messageIndex === messages.length - 1;
                const isStreaming = status === "streaming" && isLastMessage;

                return (
                  <div key={message.id}>
                    {message.parts.map((part, partIndex) => {
                      if (part.type === "reasoning") {
                        if (isOrbVisible || voiceMessageIds.current.has(message.id)) return null;
                        return (
                          <Reasoning
                            key={`${message.id}-${partIndex}`}
                            isStreaming={
                              isStreaming &&
                              partIndex === message.parts.length - 1
                            }
                          >
                            <ReasoningTrigger />
                            <ReasoningContent>{part.text}</ReasoningContent>
                          </Reasoning>
                        );
                      }

                      if (part.type === "text") {
                        // Skip rendering text while the Orb is visible or if created during voice mode
                        if (isOrbVisible || voiceMessageIds.current.has(message.id)) {
                            return null;
                        }

                        return (
                          <Message
                            key={`${message.id}-${partIndex}`}
                            from={message.role}
                          >
                            <MessageContent>
                              <MessageResponse>{part.text}</MessageResponse>
                            </MessageContent>
                            {message.role === "assistant" &&
                              isLastMessage &&
                              !isStreaming && (
                                <MessageActions>
                                  <MessageAction
                                    tooltip="Copy"
                                    // onClick={() => handleCopy(part.text)}
                                  >
                                    <Copy className="size-3" />
                                  </MessageAction>
                                  <MessageAction
                                    tooltip="Regenerate"
                                    // onClick={onRegenerate}
                                  >
                                    <RefreshCw className="size-3" />
                                  </MessageAction>
                                </MessageActions>
                              )}
                          </Message>
                        );
                      }

                      // Handle tool parts (type starts with "tool-")
                      if (part.type.startsWith("tool-")) {
                        const toolPart = part as {
                          type: `tool-${string}`;
                          state:
                            | "input-streaming"
                            | "input-available"
                            | "output-available"
                            | "output-error";
                          input?: unknown;
                          output?: unknown;
                          errorText?: string;
                        };

                        // Auto-open completed or error tools
                        const shouldOpen =
                          toolPart.state === "output-available" ||
                          toolPart.state === "output-error";

                        return (
                          <div
                            key={`${message.id}-${partIndex}`}
                            className="my-2 ml-10"
                          >
                            <Tool defaultOpen={shouldOpen}>
                              <ToolHeader
                                type={toolPart.type}
                                state={toolPart.state}
                              />
                              <ToolContent>
                                <ToolInput input={toolPart.input} />
                                {(toolPart.state === "output-available" ||
                                  toolPart.state === "output-error") && (
                                  <ToolOutput
                                    output={toolPart.output}
                                    errorText={toolPart.errorText}
                                  />
                                )}
                              </ToolContent>
                            </Tool>
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                );
              })}

              {status === "submitted" && (
                <div className="flex items-center gap-2">
                  <Loader />
                  <span className="text-sm text-muted-foreground">
                    Thinking...
                  </span>
                </div>
              )}

              {status === "error" && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                  <AlertCircle className="size-4 text-destructive" />
                  <span className="flex-1 text-sm text-destructive">
                    Failed to get response
                  </span>
                  {isLastMessageFromAssistant && (
                    <Button
                      variant="ghost"
                      size="sm"
                      //   onClick={onRegenerate}
                      className="text-destructive hover:text-destructive"
                    >
                      <RefreshCw className="mr-1 size-3" />
                      Retry
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </ConversationContent>
      </Conversation>

      <div className="mt-auto relative my-5 border-t p-4">
        <Textarea
          className="resize-none h-18 p-1 bg-primary-foreground focus:outline-none focus:ring-0 shadow-sm"
          placeholder="Create  saas landing page..."
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
          }}
          onKeyDown={async (event) => {
            if (event.key === "Enter") {
              handleSendMessage();
            }
          }}
        />
        <Button
          className="cursor-pointer text-xs absolute bottom-6 right-5"
          size="icon-sm"
          onClick={handleSendMessage}
          variant="default"
        >
          <LucideBrain />
        </Button>
      </div>
    </div>
  );
};

export default PmPage;
