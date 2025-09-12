import { config, getLeagueConfig } from "../config.js";
import type { SleeperRoster } from "../types/sleeper.js";

export class PlayerTool {
  name = "get_available_players";
  description = "Get available players (free agents) for your league with enhanced filtering and sorting";
  inputSchema = {
    type: "object",
    properties: {
      league: {
        type: "string",
        description: "League name (ROAD_TO_GLORY or DYNASTY), defaults to configured default",
        enum: ["ROAD_TO_GLORY", "DYNASTY"]
      },
      position: {
        type: "string",
        description: "Filter by position (QB, RB, WR, TE, K, DEF)",
        enum: ["QB", "RB", "WR", "TE", "K", "DEF"]
      },
      limit: {
        type: "number",
        description: "Maximum number of players to return (default: 20)",
        minimum: 1,
        maximum: 100,
        default: 20
      },
      sortBy: {
        type: "string",
        description: "Sort players by criteria (projections, trending, ownership, alphabetical)",
        enum: ["projections", "trending", "ownership", "alphabetical"],
        default: "projections"
      },
      week: {
        type: "number",
        description: "Week number for projections (defaults to current week)",
        minimum: 1,
        maximum: 18
      },
      minProjection: {
        type: "number",
        description: "Minimum projected points filter",
        minimum: 0
      },
      team: {
        type: "string",
        description: "Filter by NFL team (e.g., 'PHI', 'SF')"
      }
    }
  };

  async execute(args: any) {
    const leagueConfig = getLeagueConfig(args.league);
    
    if (!leagueConfig) {
      throw new Error(`League configuration not found for: ${args.league}`);
    }

    const limit = args.limit || 20;
    const position = args.position;
    const sortBy = args.sortBy || 'projections';
    const week = args.week || this.getCurrentWeek();
    const minProjection = args.minProjection || 0;
    const team = args.team;
    const season = new Date().getFullYear().toString();

    try {
      const fetchPromises = [
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`),
        fetch(`${config.api.baseUrl}/players/nfl`),
        fetch(`${config.api.baseUrl}/players/nfl/trending/add?lookback_hours=24&limit=100`),
        fetch(`${config.api.baseUrl}/players/nfl/trending/drop?lookback_hours=24&limit=50`)
      ];

      const responses = await Promise.all(fetchPromises);
      
      if (responses.some(r => !r.ok)) {
        throw new Error('Failed to fetch player data');
      }

      const rosters: SleeperRoster[] = await responses[0].json();
      const players = await responses[1].json();
      const trendingAdd = await responses[2].json();
      const trendingDrop = await responses[3].json();

      const ownedPlayerIds = new Set(
        rosters.flatMap(roster => roster.players || [])
      );

      // Filter players first
      const filteredPlayers = Object.entries(players)
        .filter(([playerId, player]: [string, any]) => {
          if (ownedPlayerIds.has(playerId)) return false;
          if (!player.position || player.position === 'UNK') return false;
          if (player.status === 'Inactive' || player.status === 'PUP') return false;
          if (position && player.position !== position) return false;
          if (team && player.team !== team) return false;
          return true;
        })
        .slice(0, Math.min(limit * 2, 100)); // Limit pre-projection fetching

      // Fetch projections only if needed and only for filtered players
      const playerProjections: Record<string, any> = {};
      if (sortBy === 'projections' || minProjection > 0) {
        const projectionPromises = filteredPlayers.map(async ([playerId]) => {
          try {
            const projectionResponse = await fetch(
              `https://api.sleeper.app/projections/nfl/player/${playerId}?season=${season}&season_type=regular&week=${week}`
            );
            if (projectionResponse.ok) {
              const data = await projectionResponse.json();
              playerProjections[playerId] = data.stats?.pts_ppr || 0;
            }
          } catch (error) {
            // Ignore projection fetch errors
          }
        });
        
        await Promise.all(projectionPromises);
      }

      const availablePlayers = filteredPlayers
        .map(([playerId, player]: [string, any]) => {
          const isTrendingAdd = trendingAdd.some((trend: any) => trend.player_id === playerId);
          const isTrendingDrop = trendingDrop.some((trend: any) => trend.player_id === playerId);
          const projectedPoints = playerProjections[playerId] || 0;
          
          // Apply minimum projection filter
          if (minProjection > 0 && projectedPoints < minProjection) return null;
          
          return {
            playerId,
            name: `${player.first_name} ${player.last_name}`,
            position: player.position,
            team: player.team,
            age: player.age,
            status: player.status,
            fantasyPositions: player.fantasy_positions,
            isTrendingAdd,
            isTrendingDrop,
            projectedPoints: Number(projectedPoints.toFixed(1)),
            trend: isTrendingAdd ? 'Adding' : isTrendingDrop ? 'Dropping' : 'Stable'
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => {
          switch (sortBy) {
            case 'projections':
              return parseFloat(b.projectedPoints) - parseFloat(a.projectedPoints);
            case 'trending':
              if (a.isTrendingAdd && !b.isTrendingAdd) return -1;
              if (!a.isTrendingAdd && b.isTrendingAdd) return 1;
              return parseFloat(b.projectedPoints) - parseFloat(a.projectedPoints);
            case 'alphabetical':
              return a.name.localeCompare(b.name);
            case 'ownership':
              // For now, use trending as proxy for ownership changes
              if (a.isTrendingAdd && !b.isTrendingAdd) return -1;
              if (!a.isTrendingAdd && b.isTrendingAdd) return 1;
              return a.name.localeCompare(b.name);
            default:
              return parseFloat(b.projectedPoints) - parseFloat(a.projectedPoints);
          }
        })
        .slice(0, limit);

      const result = {
        league: args.league || config.defaultLeague,
        week,
        filters: {
          position: position || 'ALL',
          team: team || 'ALL',
          minProjection: minProjection,
          sortBy: sortBy
        },
        totalAvailable: availablePlayers.length,
        players: availablePlayers,
        summary: {
          byPosition: this.getPositionSummary(availablePlayers),
          trending: {
            adding: availablePlayers.filter((p: any) => p?.isTrendingAdd).length,
            dropping: availablePlayers.filter((p: any) => p?.isTrendingDrop).length
          },
          avgProjection: availablePlayers.length > 0 ? 
            (availablePlayers.reduce((sum, p: any) => sum + parseFloat(p.projectedPoints), 0) / availablePlayers.length).toFixed(1) : 0
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
      throw new Error(`Failed to get available players: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getCurrentWeek(): number {
    const now = new Date();
    const seasonStart = new Date('2024-09-05');
    const weeksSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(18, weeksSinceStart + 1));
  }

  private getPositionSummary(players: any[]): Record<string, number> {
    return players.reduce((summary, player) => {
      summary[player.position] = (summary[player.position] || 0) + 1;
      return summary;
    }, {});
  }
}