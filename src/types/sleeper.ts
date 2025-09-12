export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  status: string;
  sport: string;
  season_type: string;
  total_rosters: number;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  settings: {
    playoff_week_start: number;
    playoff_teams: number;
    waiver_budget: number;
    [key: string]: any;
  };
}

export interface SleeperRoster {
  roster_id: number;
  league_id: string;
  owner_id: string;
  players: string[];
  starters: string[];
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_against: number;
    [key: string]: any;
  };
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number;
  points: number;
  players: string[];
  starters: string[];
  starters_points: number[];
  players_points: Record<string, number>;
}

export interface SleeperPlayer {
  player_id: string;
  position: string;
  team: string;
  first_name: string;
  last_name: string;
  full_name: string;
  age: number;
  fantasy_positions: string[];
  status: string;
}

export interface SleeperTransaction {
  transaction_id: string;
  type: 'trade' | 'waiver' | 'free_agent';
  status: string;
  roster_ids: number[];
  adds: Record<string, number>;
  drops: Record<string, number>;
  waiver_budget: Record<string, number>;
  creator: string;
  created: number;
}