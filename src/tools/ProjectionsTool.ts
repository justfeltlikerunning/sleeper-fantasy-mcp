import { config, getLeagueConfig } from "../config.js";

export class ProjectionsTool {
  name = "get_player_projections";
  description = "Get projected points for players this week";
  inputSchema = {
    type: "object",
    properties: {
      league: {
        type: "string",
        description: "League name (ROAD_TO_GLORY or DYNASTY), defaults to configured default",
        enum: ["ROAD_TO_GLORY", "DYNASTY"]
      },
      week: {
        type: "number",
        description: "Week number (defaults to current week)",
        minimum: 1,
        maximum: 18
      },
      players: {
        type: "array",
        description: "Array of player IDs to get projections for (optional - gets your roster if not provided)",
        items: {
          type: "string"
        }
      },
      position: {
        type: "string",
        description: "Filter by position (QB, RB, WR, TE, K, DEF)",
        enum: ["QB", "RB", "WR", "TE", "K", "DEF"]
      }
    }
  };

  async execute(args: any) {
    const leagueConfig = getLeagueConfig(args.league);
    
    if (!leagueConfig) {
      throw new Error(`League configuration not found for: ${args.league}`);
    }

    const week = args.week || this.getCurrentWeek();
    const season = new Date().getFullYear().toString();

    try {
      let playerIds = args.players;
      
      // If no specific players requested, get user's roster
      if (!playerIds) {
        const [rostersResponse, usersResponse] = await Promise.all([
          fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`),
          fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/users`)
        ]);

        if (!rostersResponse.ok || !usersResponse.ok) {
          throw new Error('Failed to fetch roster data');
        }

        const rosters = await rostersResponse.json();
        const users = await usersResponse.json();
        
        const userMap = new Map(users.map((user: any) => [user.user_id, user]));
        const myRoster = rosters.find((roster: any) => {
          const user: any = userMap.get(roster.owner_id);
          return user?.display_name === config.username || 
                 user?.username === config.username ||
                 user?.display_name === leagueConfig.teamName || 
                 user?.username === leagueConfig.teamName;
        });

        if (myRoster) {
          playerIds = myRoster.players;
        }
      }

      if (!playerIds || playerIds.length === 0) {
        throw new Error('No players found to get projections for');
      }

      // Fetch player data
      const playersResponse = await fetch(`${config.api.baseUrl}/players/nfl`);
      if (!playersResponse.ok) {
        throw new Error('Failed to fetch player data');
      }
      const players = await playersResponse.json();

      // Use bulk projections endpoint for better performance
      let allProjections: any[] = [];
      
      if (args.position) {
        // Fetch for specific position only
        const url = `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&position[]=${args.position}`;
        const response = await fetch(url);
        if (response.ok) {
          allProjections = await response.json();
        }
      } else {
        // Fetch for all fantasy positions
        const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
        const projectionPromises = positions.map(pos => 
          fetch(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&position[]=${pos}`)
            .then(res => res.ok ? res.json() : [])
            .catch(() => [])
        );
        
        const positionProjections = await Promise.all(projectionPromises);
        allProjections = positionProjections.flat();
      }
      
      // Create a map for quick lookup
      const projectionMap = new Map(
        allProjections.map(proj => [proj.player_id, proj])
      );

      // Filter and format player projections
      const playerProjections = [];
      
      for (const playerId of playerIds) {
        const projectionData = projectionMap.get(playerId);
        const player = players[playerId];
        
        if (!player) continue;
        
        // Apply position filter if specified
        if (args.position && player.position !== args.position) {
          continue;
        }

        const projectionStats = projectionData?.stats || {};
        const projectedPoints = projectionStats.pts_ppr || 0;

        playerProjections.push({
          playerId,
          name: `${player.first_name} ${player.last_name}`,
          position: player.position,
          team: player.team,
          status: player.status,
          projectedPoints: Number(projectedPoints.toFixed(2)),
          detailedProjections: {
            passingYards: projectionStats.pass_yd || 0,
            passingTDs: projectionStats.pass_td || 0,
            rushingYards: projectionStats.rush_yd || 0,
            rushingTDs: projectionStats.rush_td || 0,
            receivingYards: projectionStats.rec_yd || 0,
            receivingTDs: projectionStats.rec_td || 0,
            receptions: projectionStats.rec || 0,
            fieldGoals: projectionStats.fgm || 0,
            extraPoints: projectionStats.xpm || 0,
            pprPoints: projectionStats.pts_ppr || 0,
            halfPprPoints: projectionStats.pts_half_ppr || 0,
            standardPoints: projectionStats.pts_std || 0
          }
        });
      }
      
      playerProjections.sort((a: any, b: any) => b.projectedPoints - a.projectedPoints);

      const result = {
        week,
        season,
        league: args.league || config.defaultLeague,
        totalPlayers: playerProjections.length,
        projections: playerProjections,
        summary: {
          totalProjectedPoints: playerProjections.reduce((sum: number, p: any) => sum + p.projectedPoints, 0),
          averageProjection: playerProjections.length > 0 ? 
            (playerProjections.reduce((sum: number, p: any) => sum + p.projectedPoints, 0) / playerProjections.length).toFixed(1) : 0,
          topProjectedPlayer: playerProjections[0] || null
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
      throw new Error(`Failed to get projections: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getCurrentWeek(): number {
    const now = new Date();
    const seasonStart = new Date('2024-09-05');
    const weeksSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(18, weeksSinceStart + 1));
  }
}