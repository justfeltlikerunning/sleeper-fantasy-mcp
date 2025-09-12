# Sleeper Fantasy MCP

A Model Context Protocol (MCP) server for integrating Sleeper Fantasy Football with Claude Code. Get comprehensive fantasy analytics, player projections, historical performance, and league management directly through Claude.

## Features

🏈 **Complete Fantasy Analytics**
- Real-time player projections and historical scores
- Advanced NFL metrics (snap counts, target share, efficiency stats)
- Waiver wire analysis and trending players
- Lineup optimization and matchup projections

📊 **Comprehensive Player Data**
- Passing: completions, attempts, passer rating, air yards, sacks
- Rushing: YPC, broken tackles, yards after contact, red zone carries
- Receiving: catch rate, target share, drops, air yards, YAC
- Snap counts and usage percentages

🎯 **Fantasy Tools**
- Historical scoring (actual fantasy points vs projections)
- League standings and matchup analysis  
- Available players and waiver wire gems
- Trending players with add/drop activity

## Quick Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Your Leagues
Copy the example environment file and add your Sleeper information:
```bash
cp .env.example ~/.env
```

Edit `~/.env` with your details:
```bash
SLEEPER_USERNAME=your_sleeper_username
ROAD_TO_GLORY_ID=your_league_id_1  
DYNASTY_LEAGUE_ID=your_league_id_2
ROAD_TO_GLORY_TEAM=Your Team Name 1
DYNASTY_TEAM=Your Team Name 2
```

**Finding Your League ID:**
1. Open Sleeper app/website
2. Go to your league
3. Copy the long number from the URL (e.g., `1199118916182364160`)

### 3. Build the Project
```bash
npm run build
```

### 4. Add to Claude Code
Add this to your Claude Code MCP configuration in `~/.claude.json`:

```json
{
  "mcpServers": {
    "sleeper-fantasy": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/sleeper-fantasy-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

Replace `/path/to/sleeper-fantasy-mcp` with the actual path to this directory.

### 5. Restart Claude Code
Exit and restart Claude Code to load the new MCP server.

## Available Tools

### Core Fantasy Tools
- `get_league_info` - League settings and standings
- `get_my_roster` - Your current roster with player details
- `get_my_matchup` - Current week matchup analysis
- `get_available_players` - Waiver wire and free agents

### Advanced Analytics  
- `get_player_projections` - Projected fantasy points
- `get_historical_scores` - Actual historical performance with advanced stats
- `get_matchup_projections` - Compare projected vs opponent
- `optimize_lineup` - Optimal lineup suggestions

### Research Tools
- `get_trending_players` - Hot waiver wire pickups
- Player filtering by position, team, availability
- Advanced metrics like snap counts, target share, efficiency

## Example Usage

```
"What were Jalen Hurts' actual stats in Week 1?"
"Who are the trending RBs I should pick up?"  
"Optimize my lineup for this week"
"Show me my current matchup projections"
"Find available WRs with high target share"
```

## Advanced Configuration

### Multiple Leagues
You can configure up to 2 leagues (modify config.ts for more). Set league names in the environment:
- `ROAD_TO_GLORY_ID` / `ROAD_TO_GLORY_TEAM`  
- `DYNASTY_LEAGUE_ID` / `DYNASTY_TEAM`

### API Settings
- `SLEEPER_API_BASE` - Sleeper API endpoint (default: https://api.sleeper.app/v1)
- `CACHE_DURATION_MINUTES` - Cache duration for API calls (default: 15)

## Development

### Project Structure
```
src/
├── index.ts              # Main MCP server
├── config.ts             # Configuration management
└── tools/                # Individual MCP tools
    ├── LeagueTool.ts     # League information
    ├── RosterTool.ts     # Roster management  
    ├── ProjectionsTool.ts # Player projections
    ├── HistoricalScoresTool.ts # Historical performance
    └── ...
```

### Building
```bash
npm run build    # Build TypeScript
npm run watch    # Watch mode for development
npm run start    # Run the server
```

### Testing
```bash
npm test        # Verify build works
```

## Troubleshooting

### "League not found" errors
- Verify your league ID is correct (copy from Sleeper URL)
- Check that your username matches your Sleeper profile
- Ensure team name matches exactly (case sensitive)

### MCP connection issues  
- Restart Claude Code after configuration changes
- Check the path to `dist/index.js` is correct
- Verify the project built successfully (`npm run build`)

### No data returned
- Confirm you're in an active fantasy season
- Check that your leagues are public or you're a member
- Verify week numbers are valid (1-18)

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - see LICENSE file for details.