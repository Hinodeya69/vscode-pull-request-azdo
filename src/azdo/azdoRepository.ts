import * as vscode from 'vscode';
import Logger from '../common/logger';
import { Remote, parseRemote } from '../common/remote';
import { PullRequestModel } from './pullRequestModel';
import { Azdo, CredentialStore } from './credentials';
import { PRCommentController } from '../view/prCommentController';
import { convertAzdoBranchRefToIGitHubRef, convertAzdoPullRequestToRawPullRequest, convertBranchRefToBranchName } from './utils';
import { ITelemetry } from '../common/telemetry';
import { GitRepository, GitPullRequestSearchCriteria, PullRequestStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { IAccount, IGitHubRef } from './interface';
import { Identity } from 'azure-devops-node-api/interfaces/IdentitiesInterfaces';

export const PULL_REQUEST_PAGE_SIZE = 20;

export interface IMetadata extends GitRepository {
}

export class AzdoRepository implements vscode.Disposable {
	static ID = 'AzdoRepository';
	protected _initialized: boolean;
	protected _hub: Azdo | undefined;
	protected _metadata: IMetadata | undefined;
	private _toDispose: vscode.Disposable[] = [];
	public commentsController?: vscode.CommentController;
	public commentsHandler?: PRCommentController;
	public readonly isGitHubDotCom: boolean; // TODO: WTF is this for? Enterprise?

	constructor(public remote: Remote,  private readonly _credentialStore: CredentialStore, private readonly _telemetry: ITelemetry) {
		// this.isGitHubDotCom = remote.host.toLowerCase() === 'github.com';
	}

	public equals(repo: AzdoRepository): boolean {
		return this.remote.equals(repo.remote);
	}

	async ensure(): Promise<AzdoRepository> {
		this._initialized = true;

		if (!this._credentialStore.isAuthenticated()) {
			await this._credentialStore.initialize();
		}
		this._hub = this._credentialStore.getHub();

		return this;
	}

	public get azdo(): Azdo | undefined {
		return this._hub;
	}

	public async ensureCommentsController(): Promise<void> {
		try {
			if (this.commentsController) {
				return;
			}

			await this.ensure();
			this.commentsController = vscode.comments.createCommentController(`azdopr-browse-${this.remote.normalizedHost}`, `Azdo Pull Request for ${this.remote.normalizedHost}`);
			this.commentsHandler = new PRCommentController(this.commentsController);
			this._toDispose.push(this.commentsController);
			this._toDispose.push(this.commentsController);
		} catch (e) {
			console.log(e);
		}

	}

	dispose() {
		this._toDispose.forEach(d => d.dispose());
	}

	async getMetadata(): Promise<IMetadata | undefined> {
		Logger.debug(`Fetch metadata - enter`, AzdoRepository.ID);
		await this.ensure();
		const gitApi = await this._hub?.connection?.getGitApi();
		if (this._metadata) {
			Logger.debug(`Fetch metadata for repo: ${this._metadata.id}/${this._metadata.name} - cache hit`, AzdoRepository.ID);
			return this._metadata;
		}
		const repos = await gitApi?.getRepositories(this._hub?.projectName);
		this._metadata = await repos?.find(v => v.name === this.remote.repositoryName);
		if (!this._metadata) {
			Logger.debug(`Fetch metadata ${this.remote.repositoryName} failed. No repo by that name.`, AzdoRepository.ID);
			return this._metadata;
		}
		Logger.debug(`Fetch metadata ${this._metadata?.id}/${this._metadata?.name} - done`, AzdoRepository.ID);
		return this._metadata;
	}

	async getRepositoryId(): Promise<string | undefined> {
		return (await this.getMetadata())?.id;
	}

	async resolveRemote(): Promise<void> {
		try {
			const metadata = await this.getMetadata();
			const remote = parseRemote(this.remote.remoteName, metadata?.remoteUrl, this.remote.gitProtocol)!;
			// TODO Disabling this as it fixes #5 Dont know what it does
			// this.remote = remote;
			// tslint:disable-next-line: no-unused-expression
			remote;
		} catch (e) {
			Logger.appendLine(`Unable to resolve remote: ${e}`);
		}
	}

	async getDefaultBranch(): Promise<string> {
		try {
			Logger.debug(`Fetch default branch - enter`, AzdoRepository.ID);
			const metadata = await this.getMetadata();
			Logger.debug(`Fetch default branch - done`, AzdoRepository.ID);

			return convertBranchRefToBranchName(metadata?.defaultBranch || 'refs/heads/main');
		} catch (e) {
			Logger.appendLine(`AzdoRepository> Fetching default branch failed: ${e}`);
		}

		return 'main';
	}

	async getAllActivePullRequests(): Promise<PullRequestModel[]> {
		return await this.getPullRequests({status: PullRequestStatus.Active});
	}

	async getPullRequestForBranch(branch: string): Promise<PullRequestModel[]> {
		return await this.getPullRequests({ sourceRefName: branch });
	}

	async getPullRequests(search: GitPullRequestSearchCriteria): Promise<PullRequestModel[]> {
		try {
			Logger.debug(`Fetch pull requests for branch - enter`, AzdoRepository.ID);
			const azdo = await this.ensure();
			const metadata = await this.getMetadata();
			const gitApi = await azdo._hub?.connection.getGitApi();
			const result = await gitApi?.getPullRequests(metadata?.id || '', search);

			if (!result || result.length === 0) {
				Logger.appendLine(`Warning: no result data for ${this.remote.owner}/${this.remote.repositoryName} for search: ${JSON.stringify(search)}`);
				return [];
			}

			const pullRequests = await Promise.all(result
				.map(async pullRequest => {
						const pr =  await convertAzdoPullRequestToRawPullRequest(pullRequest, this);
						return new PullRequestModel(this._telemetry, this, this.remote, pr);
					}
				));

			Logger.debug(`Fetch pull requests for branch - done`, AzdoRepository.ID);
			return pullRequests;
		} catch (e) {
			Logger.appendLine(`Fetching pull requests for search: ${JSON.stringify(search)} failed: ${e}`, AzdoRepository.ID);
			if (e.code === 404) {
				// TODO: not found
				vscode.window.showWarningMessage(`Fetching pull requests for remote '${this.remote.remoteName}' failed, please check if the url ${this.remote.url} is valid.`);
				return [];
			} else {
				throw e;
			}
		}
	}

	// async getAuthenticatedUserName(): Promise<string> {
	// 	const user = await this.getAuthenticatedUser();
	// 	return user?.coreAttributes['displayName']?.value;
	// }

	// async getAuthenticatedUser(): Promise<Profile | undefined> {
	// 	try {
	// 		const azdo = await this.ensure();
	// 		// Profile api can't be hit at the org level, has to be hit at the deployment level, so url should be structured like set API_URL=https://vssps.dev.azure.com/{orgName}
	// 		const serverUrl = this.azdo?.orgUrl.replace('://dev.azure.com', '://app.vssps.visualstudio.com') || '';
	// 		console.log(serverUrl)
	// 		const profileApi = await azdo._hub?.connection.getProfileApi('https://app.vssps.visualstudio.com');
	// 		const user = await profileApi?.getProfile('me', true);
	// 		return user;
	// 	} catch (e) {
	// 		console.log(e);
	// 	}
	// }

	async getAuthenticatedUserName(): Promise<string> {
		const user = await this.getAuthenticatedUser();
		return user?.properties['Account']['$value'];
	}

	async getAuthenticatedUser(): Promise<Identity | undefined> {
		const azdo = await this.ensure();
		return azdo._hub?.authenticatedUser;
	}

	async getPullRequest(id: number): Promise<PullRequestModel | undefined> {
		try {
			Logger.debug(`Fetch pull request ${id} - enter`, AzdoRepository.ID);
			const azdo = await this.ensure();
			const gitApi = await azdo._hub?.connection.getGitApi();
			const pullRequest = await gitApi?.getPullRequestById(id);

			if (!pullRequest) {
				Logger.debug(`Fetch pull request ${id} - failed. No PR with such ID`, AzdoRepository.ID);
				return undefined;
			}

			Logger.debug(`Fetch pull request ${id} - done`, AzdoRepository.ID);

			return new PullRequestModel(this._telemetry, this, this.remote, await convertAzdoPullRequestToRawPullRequest(pullRequest, this));
		} catch (e) {
			Logger.appendLine(`Azdo> Unable to fetch PR: ${e}`);
			return;
		}
	}

	async getBranchRef(branchName: string): Promise<IGitHubRef | undefined> {
		try {
			Logger.debug(`Get branch for name ${branchName} - enter`, AzdoRepository.ID);
			const azdo = await this.ensure();
			const metadata = await this.getMetadata();
			const gitApi = await azdo._hub?.connection.getGitApi();
			const branch = await gitApi?.getBranch(metadata?.id || '', branchName);

			if (!branch) {
				Logger.debug(`Get branch for name ${branchName} - failed. No branch with such name`, AzdoRepository.ID);
				return undefined;
			}

			Logger.debug(`Get branch for name ${branchName} - done`, AzdoRepository.ID);
			return convertAzdoBranchRefToIGitHubRef(branch, this.remote.url);
		} catch (e) {
			Logger.appendLine(`Azdo> Unable to fetch PR: ${e}`);
			return {
				ref: branchName,
				repo: {cloneUrl: this.remote.url},
				sha: '',
				exists: false
			};
		}
	}

	async listBranches(): Promise<string[]> {
		try {
			Logger.debug(`List branches for ${this.remote.owner}/${this.remote.repositoryName} - enter`, AzdoRepository.ID);
			const azdo = await this.ensure();
			const metadata = await this.getMetadata();
			const gitApi = await azdo._hub?.connection.getGitApi();
			const branches = await gitApi?.getBranches(metadata!.id!)!;
			Logger.debug(`List branches for ${this.remote.owner}/${this.remote.repositoryName} - done`, AzdoRepository.ID);
			return branches?.map(branch => branch.name!) ?? [];
		} catch (e) {
			Logger.debug(`List branches for ${this.remote.owner}/${this.remote.repositoryName} failed`, AzdoRepository.ID);
			throw e;
		}
	}

	async getAssignableUsers(): Promise<IAccount[]> {
		// TODO LATER
		return [];
	}

	async getMentionableUsers(): Promise<IAccount[]> {
		// TODO LATER
		return [];
	}
}