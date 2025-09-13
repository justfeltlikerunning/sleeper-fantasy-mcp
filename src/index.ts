#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { LeagueTool } from "./tools/LeagueTool.js";
import { RosterTool } from "./tools/RosterTool.js";
import { MatchupTool } from "./tools/MatchupTool.js";
import { PlayerTool } from "./tools/PlayerTool.js";
import { ProjectionsTool } from "./tools/ProjectionsTool.js";
import { MatchupProjectionsTool } from "./tools/MatchupProjectionsTool.js";
import { LineupOptimizerTool } from "./tools/LineupOptimizerTool.js";
import { TrendingTool } from "./tools/TrendingTool.js";
import { HistoricalScoresTool } from "./tools/HistoricalScoresTool.js";
import { PlayerNewsTool } from "./tools/PlayerNewsTool.js";
import { TransactionsTool } from "./tools/TransactionsTool.js";
import { StateScheduleTool } from "./tools/StateScheduleTool.js";

const leagueTool = new LeagueTool();
const rosterTool = new RosterTool();
const matchupTool = new MatchupTool();
const playerTool = new PlayerTool();
const projectionsTool = new ProjectionsTool();
const matchupProjectionsTool = new MatchupProjectionsTool();
const lineupOptimizerTool = new LineupOptimizerTool();
const trendingTool = new TrendingTool();
const historicalScoresTool = new HistoricalScoresTool();
const playerNewsTool = new PlayerNewsTool();
const transactionsTool = new TransactionsTool();
const stateScheduleTool = new StateScheduleTool();

const server = new Server(
  {
    name: "sleeper-fantasy-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    leagueTool,
    rosterTool,
    matchupTool,
    playerTool,
    projectionsTool,
    matchupProjectionsTool,
    lineupOptimizerTool,
    trendingTool,
    historicalScoresTool,
    playerNewsTool,
    transactionsTool,
    stateScheduleTool,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    switch (name) {
      case "get_league_info":
        return await leagueTool.execute(args);
      case "get_my_roster":
        return await rosterTool.execute(args);
      case "get_my_matchup":
        return await matchupTool.execute(args);
      case "get_available_players":
        return await playerTool.execute(args);
      case "get_player_projections":
        return await projectionsTool.execute(args);
      case "get_matchup_projections":
        return await matchupProjectionsTool.execute(args);
      case "optimize_lineup":
        return await lineupOptimizerTool.execute(args);
      case "get_trending_players":
        return await trendingTool.execute(args);
      case "get_historical_scores":
        return await historicalScoresTool.execute(args);
      case "get_player_news":
        return await playerNewsTool.execute(args);
      case "get_league_transactions":
        return await transactionsTool.execute(args);
      case "get_nfl_state":
        return await stateScheduleTool.execute(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sleeper Fantasy MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});