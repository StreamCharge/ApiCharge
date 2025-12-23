@echo off
REM Build and push ApiCharge Stellar RPC mainnet image to Docker Hub

echo Building apicharge/apicharge-stellar-rpc:mainnet...

REM Change to repository root for Docker build context
pushd %~dp0..\..\..\..

docker build -t apicharge/apicharge-stellar-rpc:mainnet -f WrappedInfrastructure/StellarServers/ApiChargeStellarRPC/Release-Mainnet/Dockerfile .

if %ERRORLEVEL% NEQ 0 (
    echo Build failed!
    popd
    exit /b 1
)

echo.
echo Build successful. Push to Docker Hub? (Ctrl+C to cancel)
pause

docker push apicharge/apicharge-stellar-rpc:mainnet

if %ERRORLEVEL% NEQ 0 (
    echo Push failed! Make sure you are logged in: docker login
    popd
    exit /b 1
)

popd
echo.
echo Successfully pushed apicharge/apicharge-stellar-rpc:mainnet
