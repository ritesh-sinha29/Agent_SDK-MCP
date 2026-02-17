
import { ConvexHttpClient } from "convex/browser";
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import {
  type InferUITools,
  type ToolSet,
  type UIDataTypes,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { sendEmail } from "@/lib/mail";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const localTools = {
  getIssues: tool({
    description: "Get number of issues for the current repository connected.",
    parameters: z.object({
      repoId: z.string(),
      limit: z.number().optional(),
    }),
    // @ts-ignore
    execute: async ({
      repoId,
      limit,
    }: {
      repoId: Id<"repositories">;
      limit: number;
    }) => {
      console.log("----------Called issues tool----------", repoId, limit);
      const allIssues = await convex.query(api.repo.getIssueTool, {
        repoId,
        limit,
      });

      return { issues: allIssues };
    },
  }),
  searchWeb: tool({
    description:
      "Search the web for user query related to tech etc to get Latest information about it.",
    // @ts-ignore
    inputSchema: z.object({
      query: z.string().describe("The search query"),
    }),
    // needsApproval: true,
    // @ts-ignore
    execute: async ({ query }: { query: string }) => {
      console.log("query and Mode by AI: ====> ", query);
      const apiKey = process.env.FIRECRAWL_API_KEY;
      if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");
      const res = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url: query }),
      });
      const data = await res.json();
      console.log("data from firecrawl", data);
      // @ts-ignore
      return data.data?.content || data.data?.markdown || "No content found";
    },
  }),
  sendEmail: tool({
    description: "Send an email to the user with the given subject and body.",
    // @ts-ignore
    inputSchema: z.object({
      to: z.string().describe("The recipient's email address"),
      subject: z.string().describe("The email subject"),
      body: z.string().describe("The email body"),
    }),
    // @ts-ignore
    execute: async ({
      to,
      subject,
      body,
    }: {
      to: string;
      subject: string;
      body: string;
    }) => {
      console.log(
        "----------Called sendEmail tool----------",
        to,
        subject,
        body,
      );
      const result = await sendEmail({ to, subject, body });
      return result;
    },
  }),
} satisfies ToolSet;

export type ChatTools = InferUITools<typeof localTools>;

export type ChatMessage = UIMessage<never, UIDataTypes, ChatTools>;

export async function POST(req: Request) {
  try {
    const { messages, repoId }: { messages: ChatMessage[]; repoId: string } =
      await req.json();
    console.log("Repo ID recieved----------------->", repoId);
    console.log("Message recieved API/AGENT/CHAT: --------->", messages);

    const repo = await convex.query(api.repo.getRepoById, {
      repoId: repoId as Id<"repositories">,
    });
    const repoName = repo?.repoName || repoId;

    const systemPrompt = `You are a friendly and enthusiastic Agentic Assistant here to help users with their repositories. Think of yourself as a knowledgeable and supportive friend.
You are currently working on the repository: ${repoName}

You can:
- Get issues for the current repository connected (Number of issues or recent issues).
- Search the web for user query related to tech etc to get Latest information about it.
- Send an email to the user with the given subject and body.

When the user asks about anything related to tech or any problem related to their project or repo, help them cheerfully!
Important: 
- Behave as a super intelligent but very approachable and friendly Assistant.
- Call Tools you think is Important.
- Act like a supportive friend who happens to be an expert developer/PM. Use casual but clear language.
- Use emojis occasionally to keep the tone light.
- Use repoId if you need to call Issues tool ${repoId}
- Always refer to the repository by its name "${repoName}" instead of its ID.`;

    const result = streamText({
      model: google("gemini-3-flash-preview"),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: localTools,
      toolChoice: "auto",
      stopWhen: stepCountIs(5),
      onFinish: async ({ text }) => {
        // to:do save in db
        console.log("Ai reponse by Agent Streamed ");
      },
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      sendSources: true,
    });
  } catch (error) {
    console.error("Error in chat route:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
