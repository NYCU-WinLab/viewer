<?php

declare(strict_types=1);

namespace OCA\WinlabViewer\Controller;

use OCA\WinlabViewer\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;

/**
 * /apps/winlab_viewer/open?path=<path>: the file in WinLab Viewer, framed
 * in a Nextcloud page, so the Nextcloud header and menu stay.
 */
class PageController extends Controller {
	public function __construct(IRequest $request) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function open(string $path = ''): TemplateResponse {
		$src = Application::VIEWER_URL . '/embed/nextcloud?' . http_build_query(['path' => $path]);
		$response = new TemplateResponse(Application::APP_ID, 'open', [
			'src' => $src,
			'name' => basename($path),
		]);
		$policy = new ContentSecurityPolicy();
		$policy->addAllowedFrameDomain(Application::VIEWER_URL);
		$response->setContentSecurityPolicy($policy);
		return $response;
	}
}
