import { Annotation, MessagesAnnotation, MemorySaver, StateGraph, START, END, interrupt } from '@langchain/langgraph';
import { AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { gemini } from '../lib/gemini';
import { EventQueue } from './eventQueue';
import { SECTOR_COORDS } from '../data/sectors';
import { SERVICE_CATEGORIES } from '../data/providers';
import { Booking } from '../schemas/booking';
import {
  searchProviders, rankByDistance, checkAvailability, confirmBooking, scheduleReminder,
  resolveBookingTarget, proposeBookingChange, proposeBookingCancellation, answerBookingQuery
} from './tools';
import {
  classifierPrompt, intentExtractionPrompt, NEW_BOOKING_SYSTEM, bookingFlowSystem
} from './prompts';
import { ToolNode } from '@langchain/langgraph/prebuilt';

export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  intent: Annotation<any>({
    reducer: (old, updated) => updated ?? old,
    default: () => null,
  }),
  flow: Annotation<string>({
    reducer: (old, updated) => updated ?? old,
    default: () => 'new_booking',
  })
});

const IntentSchema = z.object({
  service: z.enum(SERVICE_CATEGORIES as [string, ...string[]]).optional(),
  location: z.string().optional(),
  time: z.string().optional(),
});

const IntentClassifierSchema = z.object({
  intent: z.enum(['new_booking', 'modify_booking', 'cancel_booking', 'query_booking']),
  reasoning: z.string(),
});

const newBookingTools = [searchProviders, rankByDistance, checkAvailability, confirmBooking, scheduleReminder];
const modifyTools = [resolveBookingTarget, proposeBookingChange];
const cancelTools = [resolveBookingTarget, proposeBookingCancellation];
const queryTools = [resolveBookingTarget, answerBookingQuery];

const toolNode = new ToolNode([...newBookingTools, ...modifyTools, ...cancelTools, ...queryTools]);

const newBookingModel = gemini.bindTools(newBookingTools);
const modifyModel = gemini.bindTools(modifyTools);
const cancelModel = gemini.bindTools(cancelTools);
const queryModel = gemini.bindTools(queryTools);

function bookingsSummary(bookings: Booking[]): string {
  if (!bookings.length) return '(no bookings)';
  return bookings.map((b, i) =>
    `${i + 1}. id=${b.id} | ${b.category} with ${b.providerName} | ${b.scheduledFor} | status=${b.status}`
  ).join('\n');
}

/**
 * Shared guard for the modify/cancel/query flows: when the user has no bookings,
 * surface a friendly nudge and pause the graph. `thought` lets each flow phrase
 * what the user was trying to do.
 */
function interruptNoBookings(queue: EventQueue, thought: string): never {
  queue.push({ type: 'thought', text: thought });
  queue.push({ type: 'awaiting_user', missing: 'service', question: "You don't have any bookings yet — would you like to make one?" });
  interrupt('Missing bookings');
  throw new Error('unreachable'); // interrupt() throws; satisfies the `never` contract
}

/**
 * Shared post-tool check for the booking flows: if the last resolveBookingTarget
 * call could not pin down a single booking, ask the user to clarify and pause.
 */
function interruptIfAmbiguous(state: typeof AgentState.State, response: AIMessage, queue: EventQueue): void {
  const lastTool = [...state.messages].reverse().find(m => m.getType() === 'tool') as ToolMessage | undefined;
  if (lastTool && lastTool.name === 'resolveBookingTarget') {
    const parsed = typeof lastTool.content === 'string' ? JSON.parse(lastTool.content) : lastTool.content;
    if (!parsed.bookingId) {
      queue.push({
        type: 'awaiting_user',
        missing: 'service',
        question: response.content && typeof response.content === 'string'
          ? response.content
          : 'Which booking did you mean?',
      });
      interrupt('Ambiguous target');
    }
  }
}

async function classifyIntent(state: typeof AgentState.State, config: any) {
  const queue = config.configurable?.eventQueue as EventQueue;
  const bookings = config.configurable?.bookings as Booking[] || [];
  
  const lastMsg = state.messages[state.messages.length - 1];
  
  const structuredModel = gemini.withStructuredOutput(IntentClassifierSchema);
  const result = await structuredModel.invoke(classifierPrompt(lastMsg.content, bookings));
  queue.push({ type: 'thought', text: `Classified intent as ${result.intent}: ${result.reasoning}` });
  
  return { flow: result.intent };
}

async function intentExtraction(state: typeof AgentState.State, config: any) {
  const queue = config.configurable?.eventQueue as EventQueue;
  const defaultLocation = config.configurable?.defaultLocation as string | undefined;
  
  const textMessages = state.messages
    .filter(m => m.getType() === 'human' || m.getType() === 'ai')
    .map(m => `${m.getType()}: ${m.content}`)
    .join("\n");
  
  const structuredModel = gemini.withStructuredOutput(IntentSchema);
  const extracted = await structuredModel.invoke(intentExtractionPrompt(textMessages, SERVICE_CATEGORIES));

  let usedDefaultLocation = false;
  if (!extracted.location && defaultLocation) {
    extracted.location = defaultLocation;
    usedDefaultLocation = true;
  }

  if (extracted.location) {
    extracted.location = extracted.location.toUpperCase();
  }

  queue.push({
    type: 'understanding',
    extracted: {
      service: extracted.service || null,
      location: extracted.location || null,
      time: extracted.time || null,
      resolvedSlot: null,
    },
    usedDefaultLocation,
  });

  return { intent: extracted };
}

async function gate(state: typeof AgentState.State, config: any) {
  const queue = config.configurable?.eventQueue as EventQueue;
  const extracted = state.intent;

  if (!extracted || !extracted.service || !extracted.location || !extracted.time || !SECTOR_COORDS[extracted.location]) {
    if (!extracted?.service) {
      queue.push({ type: 'awaiting_user', missing: 'service', question: 'What service do you need? (AC repair, plumber, electrician, tutor, beautician)' });
    } else if (!extracted?.location || !SECTOR_COORDS[extracted.location]) {
      queue.push({ type: 'awaiting_user', missing: 'location', question: 'Which sector are you in?' });
    } else if (!extracted?.time) {
      queue.push({ type: 'awaiting_user', missing: 'time', question: 'When do you need this?' });
    }
    
    interrupt("Missing fields");
  }

  return {};
}

async function newBookingAgent(state: typeof AgentState.State, config: any) {
  const queue = config.configurable?.eventQueue as EventQueue;
  const sysMsg = new SystemMessage(NEW_BOOKING_SYSTEM);

  const response = await newBookingModel.invoke([sysMsg, ...state.messages]);
  
  if (response.content && typeof response.content === 'string' && response.content.trim()) {
    queue.push({ type: 'thought', text: response.content.trim() });
  }

  return { messages: [response] };
}

/**
 * The modify / cancel / query flows are structurally identical: guard on empty
 * history, build a system prompt over the bookings, invoke a flow-specific model,
 * surface any narration as a thought, then pause if the target is ambiguous.
 * They differ only in the empty-history note, the model, and the task instructions.
 */
type BookingFlowConfig = {
  emptyHistoryThought: string;
  model: ReturnType<typeof gemini.bindTools>;
  role: string;
  taskInstructions: string;
};

function makeBookingFlowAgent(flow: BookingFlowConfig) {
  return async function bookingFlowAgent(state: typeof AgentState.State, config: any) {
    const queue = config.configurable?.eventQueue as EventQueue;
    const bookings = config.configurable?.bookings as Booking[] || [];

    if (bookings.length === 0) {
      interruptNoBookings(queue, flow.emptyHistoryThought);
    }

    const sysMsg = new SystemMessage(
      bookingFlowSystem(flow.role, bookingsSummary(bookings), flow.taskInstructions),
    );

    const response = await flow.model.invoke([sysMsg, ...state.messages]);
    if (response.content && typeof response.content === 'string' && response.content.trim()) {
      queue.push({ type: 'thought', text: response.content.trim() });
    }

    interruptIfAmbiguous(state, response, queue);

    return { messages: [response] };
  };
}

const modifyAgent = makeBookingFlowAgent({
  emptyHistoryThought: "User asked to modify a booking but I don't see any in their history.",
  model: modifyModel,
  role: 'modifying an existing booking',
  taskInstructions: "Use resolveBookingTarget with the user's phrasing to pick the right one. Then determine what the user wants to change (time, slot, day). If they're rescheduling, compute the new scheduledTimestamp. Call proposeBookingChange with the changes + a 1-sentence reason.",
});

const cancelAgent = makeBookingFlowAgent({
  emptyHistoryThought: "User asked to cancel a booking but I don't see any in their history.",
  model: cancelModel,
  role: 'canceling an existing booking',
  taskInstructions: "Use resolveBookingTarget with the user's phrasing to pick the right one. Confirm intent via a thought (no awaiting_user — the user already said cancel). Call proposeBookingCancellation with a 1-sentence reason.",
});

const queryAgent = makeBookingFlowAgent({
  emptyHistoryThought: "User asked about a booking but I don't see any in their history.",
  model: queryModel,
  role: 'answering questions about an existing booking',
  taskInstructions: "Use resolveBookingTarget with the user's phrasing to pick the right one. Generate a 2-3 sentence summary answering the user's question using the booking data. Call answerBookingQuery with the summary.",
});

function routeAfterClassify(state: typeof AgentState.State) {
  const flow = state.flow || 'new_booking';
  if (flow === 'new_booking') return 'intent_extraction';
  if (flow === 'modify_booking') return 'modifyAgent';
  if (flow === 'cancel_booking') return 'cancelAgent';
  if (flow === 'query_booking') return 'queryAgent';
  return 'intent_extraction';
}

function routeAfterGate(state: typeof AgentState.State) {
  const ext = state.intent;
  if (!ext || !ext.service || !ext.location || !ext.time || !SECTOR_COORDS[ext.location]) {
    return "intent_extraction";
  }
  return "newBookingAgent";
}

function routeAfterAgent(state: typeof AgentState.State) {
  const last = state.messages[state.messages.length - 1];
  if (last.getType() === "ai" && (last as AIMessage).tool_calls?.length) {
    return "tools";
  }
  return END;
}

function routeAfterTools(state: typeof AgentState.State) {
  // Return to the correct agent based on flow
  const flow = state.flow || 'new_booking';
  if (flow === 'new_booking') return 'newBookingAgent';
  if (flow === 'modify_booking') return 'modifyAgent';
  if (flow === 'cancel_booking') return 'cancelAgent';
  if (flow === 'query_booking') return 'queryAgent';
  return 'newBookingAgent';
}

const workflow = new StateGraph(AgentState)
  .addNode("classifyIntent", classifyIntent)
  .addNode("intent_extraction", intentExtraction)
  .addNode("gate", gate)
  .addNode("newBookingAgent", newBookingAgent)
  .addNode("modifyAgent", modifyAgent)
  .addNode("cancelAgent", cancelAgent)
  .addNode("queryAgent", queryAgent)
  .addNode("tools", toolNode)

  .addEdge(START, "classifyIntent")
  .addConditionalEdges("classifyIntent", routeAfterClassify)
  
  .addEdge("intent_extraction", "gate")
  .addConditionalEdges("gate", routeAfterGate)
  
  .addConditionalEdges("newBookingAgent", routeAfterAgent)
  .addConditionalEdges("modifyAgent", routeAfterAgent)
  .addConditionalEdges("cancelAgent", routeAfterAgent)
  .addConditionalEdges("queryAgent", routeAfterAgent)
  
  .addConditionalEdges("tools", routeAfterTools);

const checkpointer = new MemorySaver();
export const graph = workflow.compile({ checkpointer });
