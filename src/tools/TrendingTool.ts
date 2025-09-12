import { config, getLeagueConfig } from "../config.js";

export class TrendingTool {
  name = "get_trending_players";
  description = "Get trending players with add/drop activity and analysis";
  inputSchema = {
    type: "object",
    properties: {
      league: {
        type: "string",
        description: "League name (ROAD_TO_GLORY or DYNASTY), defaults to configured default",
        enum: ["ROAD_TO_GLORY", "DYNASTY"]
      },
      type: {
        type: "string",
        description: "Type of trending activity (add, drop, both)",
        enum: ["add", "drop", "both"],
        default: "both"
      },
      lookbackHours: {
        type: "number",
        description: "Hours to look back for trending activity (default: 24)",
        minimum: 1,
        maximum: 168,
        default: 24
      },
      limit: {
        type: "number",
        description: "Maximum number of players to return (default: 20)",
        minimum: 1,
        maximum: 50,
        default: 20
      },
      position: {
        type: "string",
        description: "Filter by position (QB, RB, WR, TE, K, DEF)",
        enum: ["QB", "RB", "WR", "TE", "K", "DEF"]
      },
      availableOnly: {
        type: "boolean",
        description: "Only show players available in your league (default: true)",
        default: true
      }
    }
  };

  async execute(args: any) {
    const leagueConfig = getLeagueConfig(args.league);
    
    if (!leagueConfig) {
      throw new Error(`League configuration not found for: ${args.league}`);
    }

    const type = args.type || 'both';
    const lookbackHours = args.lookbackHours || 24;
    const limit = args.limit || 20;
    const position = args.position;
    const availableOnly = args.availableOnly !== false;

    try {
      const fetchPromises = [
        fetch(`${config.api.baseUrl}/players/nfl`)
      ];

      // Fetch trending data based on type
      if (type === 'add' || type === 'both') {
        fetchPromises.push(
          fetch(`${config.api.baseUrl}/players/nfl/trending/add?lookback_hours=${lookbackHours}&limit=100`)
        );
      }
      
      if (type === 'drop' || type === 'both') {
        fetchPromises.push(
          fetch(`${config.api.baseUrl}/players/nfl/trending/drop?lookback_hours=${lookbackHours}&limit=100`)
        );
      }

      // If availableOnly is true, fetch rosters to filter out owned players
      if (availableOnly) {
        fetchPromises.push(
          fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`)
        );
      }

      const responses = await Promise.all(fetchPromises);
      
      if (responses.some(r => !r.ok)) {
        throw new Error('Failed to fetch trending player data');
      }

      const players = await responses[0].json();
      
      let trendingAdd: any[] = [];
      let trendingDrop: any[] = [];
      let rosters: any[] = [];
      
      let responseIndex = 1;
      
      if (type === 'add' || type === 'both') {
        trendingAdd = await responses[responseIndex].json();
        responseIndex++;
      }
      
      if (type === 'drop' || type === 'both') {
        trendingDrop = await responses[responseIndex].json();
        responseIndex++;
      }
      
      if (availableOnly) {
        rosters = await responses[responseIndex].json();
      }

      // Create set of owned players if filtering by availability
      const ownedPlayerIds = availableOnly ? 
        new Set(rosters.flatMap((roster: any) => roster.players || [])) : new Set();

      // Combine trending data
      const trendingPlayerMap = new Map();
      
      trendingAdd.forEach((trend: any) => {
        trendingPlayerMap.set(trend.player_id, {
          playerId: trend.player_id,
          addCount: trend.count,
          dropCount: 0,
          netActivity: trend.count,
          trend: 'Adding'
        });
      });

      trendingDrop.forEach((trend: any) => {
        const existing = trendingPlayerMap.get(trend.player_id);
        if (existing) {
          existing.dropCount = trend.count;
          existing.netActivity = existing.addCount - trend.count;
          existing.trend = existing.addCount > trend.count ? 'Net Adding' : 'Net Dropping';
        } else {
          trendingPlayerMap.set(trend.player_id, {
            playerId: trend.player_id,
            addCount: 0,
            dropCount: trend.count,
            netActivity: -trend.count,
            trend: 'Dropping'
          });
        }
      });

      // Filter and enhance with player details
      const trendingPlayers = Array.from(trendingPlayerMap.values())
        .map((trending: any) => {
          const player = players[trending.playerId];
          
          if (!player) return null;
          
          // Apply filters
          if (position && player.position !== position) return null;
          if (availableOnly && ownedPlayerIds.has(trending.playerId)) return null;
          if (player.status === 'Inactive' || player.status === 'PUP') return null;

          return {
            playerId: trending.playerId,
            name: `${player.first_name} ${player.last_name}`,
            position: player.position,
            team: player.team,
            status: player.status,
            age: player.age,
            addCount: trending.addCount,
            dropCount: trending.dropCount,
            netActivity: trending.netActivity,
            trend: trending.trend,
            activityScore: Math.abs(trending.netActivity),
            isAvailable: !ownedPlayerIds.has(trending.playerId)
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => {
          // Sort by activity score (absolute value of net activity) descending
          if (b.activityScore !== a.activityScore) {
            return b.activityScore - a.activityScore;
          }
          // Then by net activity (positive is better)
          return b.netActivity - a.netActivity;
        })
        .slice(0, limit);

      const result = {
        league: args.league || config.defaultLeague,
        filters: {
          type,
          lookbackHours,
          position: position || 'ALL',
          availableOnly
        },
        timeframe: `Last ${lookbackHours} hours`,
        totalTrending: trendingPlayers.length,
        players: trendingPlayers,
        summary: {
          byTrend: {
            adding: trendingPlayers.filter((p: any) => p?.trend?.includes('Adding')).length,
            dropping: trendingPlayers.filter((p: any) => p?.trend?.includes('Dropping')).length
          },
          byPosition: this.getPositionSummary(trendingPlayers),
          topAdds: trendingPlayers
            .filter((p: any) => p?.addCount > 0)
            .slice(0, 5)
            .map((p: any) => ({ name: p?.name, position: p?.position, adds: p?.addCount })),
          topDrops: trendingPlayers
            .filter((p: any) => p?.dropCount > 0)
            .slice(0, 5)
            .map((p: any) => ({ name: p?.name, position: p?.position, drops: p?.dropCount }))
        }
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get trending players: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getPositionSummary(players: any[]): Record<string, number> {
    return players.reduce((summary, player) => {
      summary[player.position] = (summary[player.position] || 0) + 1;
      return summary;
    }, {});
  }
}